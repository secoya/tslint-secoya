import * as ts from 'typescript';

import * as Lint from 'tslint';
import { flatMap, mapDefined } from 'tslint/lib/utils';

const optionsDescription = Lint.Utils.dedent`
    Enforces consistent formatting of class members. Namely
      * No extra leading new line before first member.
      * No extra tailing new line after last member.
      * All field variables within same visibility and static/instance type must not be separated with extra new lines.
	  * Anything else should have extra new line sepration.`;

export class Rule extends Lint.Rules.AbstractRule {
	/* tslint:disable:object-literal-sort-keys */
	public static metadata: Lint.IRuleMetadata = {
		ruleName: 'class-members-whitespacing',
		description: 'Enforces consistent formatting of class members.',
		rationale: 'Consistent formatting.',
		optionsDescription,
		options: null,
		type: 'maintainability',
		typescriptOnly: false,
	};
	/* tslint:enable:object-literal-sort-keys */

	public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
		return this.applyWithWalker(new WhitespacingWalker(sourceFile, this.getOptions()));
	}
}

// tslint:disable-next-line:max-classes-per-file
export class WhitespacingWalker extends Lint.RuleWalker {
	constructor(sourceFile: ts.SourceFile, options: Lint.IOptions) {
		super(sourceFile, options);
	}

	private makeFixWithOneLeadingNewLines(
		node: ts.Node,
	): Lint.Replacement {
		const trivia = leadingTriviaText(node);
		const hasNewLines = substringCount(trivia, '\n');
		if (!hasNewLines) {
			return Lint.Replacement.replaceFromTo(node.getFullStart(), node.getStart(), '\n' + trivia);
		}
		const replacement = replaceBlankLinesWith(node, '\n');
		return Lint.Replacement.replaceFromTo(node.getFullStart(), node.getStart(), replacement);
	}

	private makeFixWithTwoLeadingNewLines(
		node: ts.Node,
	): Lint.Replacement {
		const trivia = leadingTriviaText(node);
		const hasNewLines = substringCount(trivia, '\n');
		if (!hasNewLines) {
			return Lint.Replacement.replaceFromTo(node.getFullStart(), node.getStart(), '\n\n' + trivia);
		}
		const replacementOneNewLine = replaceBlankLinesWith(node, '\n');
		const firstNewLine = trivia.indexOf('\n');
		const replacement =
			replacementOneNewLine.substring(0, firstNewLine) +
			'\n' +
			replacementOneNewLine.substring(firstNewLine);
		return Lint.Replacement.replaceFromTo(node.getFullStart(), node.getStart(), replacement);
	}

	private visitClassMembers(
		members: ts.NodeArray<ts.ClassElement>,
		endClassToken: ts.Node,
	) {
		if (members.length === 0) {
			return;
		}

		const firstMember = members[0];
		if (hasAtLeastOneBlankLine(firstMember)) {
			this.addFailureAtNode(
				firstMember,
				'Expected no extranous leading new line',
				this.makeFixWithOneLeadingNewLines(firstMember),
			);
		} else if (substringCount(leadingTriviaText(endClassToken), '\n') === 0) {
			this.addFailureAtNode(
				firstMember,
				'Expected a single leading new line',
				this.makeFixWithOneLeadingNewLines(firstMember),
			);
		}

		if (hasAtLeastOneBlankLine(endClassToken)) {
			this.addFailureAtNode(
				endClassToken,
				'Expected no extranous leading new line',
				this.makeFixWithOneLeadingNewLines(endClassToken),
			);
		} else if (substringCount(leadingTriviaText(endClassToken), '\n') === 0) {
			this.addFailureAtNode(
				endClassToken,
				'Expected a single leading new line',
				this.makeFixWithOneLeadingNewLines(endClassToken),
			);
		}

		let lastMembeKind: MemberKind = getMemberKind(firstMember);
		for (let i = 1; i < members.length; i++) {
			const member = members[i];
			const memberKind = getMemberKind(member);
			if (lastMembeKind !== memberKind || memberKind === 'constructor' || memberKind === 'method') {
				if (hasNoBlankLines(member)) {
					this.addFailureAtNode(
						member,
						'Expected two leading new lines',
						this.makeFixWithTwoLeadingNewLines(member),
					);
				} else if (countBlankLines(member) !== 1) {
					this.addFailureAtNode(
						member,
						'Expected two leading new lines',
						this.makeFixWithTwoLeadingNewLines(member),
					);
				}
			} else {
				if (!hasNoBlankLines(member)) {
					this.addFailureAtNode(
						member,
						'Expected a single leading new line',
						this.makeFixWithOneLeadingNewLines(member),
					);
				}
			}
			lastMembeKind = memberKind;
		}
	}

	protected visitClassDeclaration(node: ts.ClassDeclaration) {
		super.visitClassDeclaration(node);
		this.visitClassMembers(node.members, node.getLastToken());
	}

	protected visitClassExpression(node: ts.ClassExpression) {
		super.visitClassExpression(node);
		this.visitClassMembers(node.members, node.getLastToken());
	}
}

type Access = 'public' | 'protected' | 'private';
type MemberKind =
	'constructor' |
	'private-static-field' |
	'protected-static-field' |
	'public-static-field' |
	'static-method' |
	'private-field' |
	'protected-field' |
	'public-field' |
	'method'
	;

function getMemberKind(member: ts.ClassElement): MemberKind {
	const accessLevel = hasModifier(ts.SyntaxKind.PrivateKeyword) ? 'private'
		: hasModifier(ts.SyntaxKind.ProtectedKeyword) ? 'protected'
			: 'public';

	switch (member.kind) {
		case ts.SyntaxKind.Constructor:
		case ts.SyntaxKind.ConstructSignature:
			return 'constructor';

		case ts.SyntaxKind.PropertyDeclaration:
		case ts.SyntaxKind.PropertySignature:
			return methodOrField(isFunctionLiteral((member as ts.PropertyDeclaration).initializer));

		case ts.SyntaxKind.MethodDeclaration:
		case ts.SyntaxKind.MethodSignature:
			return methodOrField(true);

		default:
			return 'method';
	}

	function methodOrField(isMethod: boolean) {
		const membership = hasModifier(ts.SyntaxKind.StaticKeyword) ? 'Static' : 'Instance';
		return memberKindForMethodOrField(accessLevel, membership, isMethod ? 'Method' : 'Field');
	}

	function hasModifier(kind: ts.SyntaxKind) {
		return Lint.hasModifier(member.modifiers, kind);
	}
}

function isFunctionLiteral(node: ts.Node | undefined) {
	switch (node && node.kind) {
		case ts.SyntaxKind.ArrowFunction:
		case ts.SyntaxKind.FunctionExpression:
			return true;
		default:
			return false;
	}
}

function memberKindForMethodOrField(
	access: Access,
	membership: 'Static' | 'Instance',
	kind: 'Method' | 'Field',
): MemberKind {
	if (kind === 'Field') {
		return (access + (membership === 'Static' ? '-static' : '') + 'field') as MemberKind;
	}
	return 'method';
}

function leadingTriviaText(node: ts.Node): string {
	const fullText = node.getFullText();
	const triviaLength = node.getStart() - node.getFullStart();

	return fullText.substring(0, triviaLength);
}

function countBlankLines(node: ts.Node): number {
	const regex = /(\n|\r)( |\t)*(\r|\n)/g;
	let count = 0;
	const trivia = leadingTriviaText(node);
	let found;
	// This is so much easier to read & write to be quite honest
	// tslint:disable-next-line:no-conditional-assignment
	while ((found = regex.exec(trivia)) != null) {
		count++;
		regex.lastIndex -= found[0].length - 1;
	}
	return count;
}

function replaceBlankLinesWith(node: ts.Node, replacementString: string): string {
	return leadingTriviaText(node).replace(/(\n|\r)(( |\t)*(\r|\n))+/g, replacementString);
}

function hasAtLeastOneBlankLine(node: ts.Node): boolean {
	return countBlankLines(node) >= 1;
}

function hasOneBlankLine(node: ts.Node): boolean {
	return countBlankLines(node) === 1;
}

function hasNoBlankLines(node: ts.Node): boolean {
	return countBlankLines(node) === 0;
}

function substringCount(str: string, subString: string): number {
	if (subString.length <= 0) {
		return (str.length + 1);
	}

	let n = 0;
	let pos = 0;
	const step = subString.length;

	while (true) {
		pos = str.indexOf(subString, pos);
		if (pos >= 0) {
			++n;
			pos += step;
		} else {
			break;
		}
	}
	return n;
}
