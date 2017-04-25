/**
 * @license
 * Copyright 2013 Palantir Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as ts from 'typescript';

import * as Lint from 'tslint';
import { flatMap, mapDefined } from 'tslint/lib/utils';

const OPTION_ORDER = 'order';
const OPTION_ALPHABETIZE = 'alphabetize';
const OPTION_LIFECYCLEORDERINGS = 'lifecycleOrderings';

enum MemberKind {
	publicStaticField,
	publicStaticMethod,
	protectedStaticField,
	protectedStaticMethod,
	privateStaticField,
	privateStaticMethod,
	publicInstanceField,
	protectedInstanceField,
	privateInstanceField,
	publicConstructor,
	protectedConstructor,
	privateConstructor,
	publicInstanceMethod,
	protectedInstanceMethod,
	privateInstanceMethod,
	reactLifecycleMethod,
	reactRenderMethod,
}

const PRESETS = new Map<string, MemberCategoryJson[]>([
	['fields-first', [
		'public-static-field',
		'protected-static-field',
		'private-static-field',
		'public-instance-field',
		'protected-instance-field',
		'private-instance-field',
		'constructor',
		'react-lifecycle-method',
		'public-static-method',
		'protected-static-method',
		'private-static-method',
		'public-instance-method',
		'protected-instance-method',
		'private-instance-method',
		'react-render-method',
	]],
	['instance-sandwich', [
		'public-static-field',
		'protected-static-field',
		'private-static-field',
		'public-instance-field',
		'protected-instance-field',
		'private-instance-field',
		'constructor',
		'react-lifecycle-method',
		'public-instance-method',
		'protected-instance-method',
		'private-instance-method',
		'react-render-method',
		'public-static-method',
		'protected-static-method',
		'private-static-method',
	]],
	['statics-first', [
		'public-static-field',
		'public-static-method',
		'protected-static-field',
		'protected-static-method',
		'private-static-field',
		'private-static-method',
		'public-instance-field',
		'protected-instance-field',
		'private-instance-field',
		'constructor',
		'react-lifecycle-method',
		'public-instance-method',
		'protected-instance-method',
		'private-instance-method',
		'react-render-method',
	]],
]);
const PRESET_NAMES = Array.from(PRESETS.keys());

const allMemberKindNames = mapDefined(Object.keys(MemberKind), (key) => {
	const mk = (MemberKind as any)[key];
	return typeof mk === 'number' ? MemberKind[mk].replace(/[A-Z]/g, (cap) => '-' + cap.toLowerCase()) : undefined;
});

function namesMarkdown(names: string[]): string {
	return names.map((name) => '* `' + name + '`').join('\n    ');
}

const optionsDescription = Lint.Utils.dedent`
    One argument, which is an object, must be provided. It should contain an \`order\` property.
    The \`order\` property should have a value of one of the following strings:
    ${namesMarkdown(PRESET_NAMES)}
    Alternatively, the value for \`order\` maybe be an array consisting of the following strings:
    ${namesMarkdown(allMemberKindNames)}
    You can also omit the access modifier to refer to "public-", "protected-", and "private-" all at once;
    for example, "static-field".
    You can also make your own categories by using an object instead of a string:
        {
            "name": "static non-private",
            "kinds": [
                "public-static-field",
                "protected-static-field",
                "public-static-method",
                "protected-static-method"
            ]
        }
    The '${OPTION_ALPHABETIZE}' option will enforce that members within the same category
    should be alphabetically sorted by name.`;

export class Rule extends Lint.Rules.AbstractRule {
	/* tslint:disable:object-literal-sort-keys */
	public static metadata: Lint.IRuleMetadata = {
		ruleName: 'react-aware-member-ordering',
		description: 'Enforces member ordering. Also with special handling of react methods.',
		rationale: 'A consistent ordering for class members can make classes easier to read, navigate, and edit.',
		optionsDescription,
		options: {
			type: 'object',
			properties: {
				order: {
					oneOf: [{
						type: 'string',
						enum: PRESET_NAMES,
					}, {
						type: 'array',
						items: {
							type: 'string',
							enum: allMemberKindNames,
						},
						maxLength: 13,
					}],
				},
			},
			additionalProperties: false,
		},
		optionExamples: [
			'[true, { "order": "fields-first" }]',
			Lint.Utils.dedent`
			[true, {
				"order": [
					"static-field",
					"instance-field",
					"constructor",
					"public-instance-method",
					"protected-instance-method",
					"private-instance-method"
				]
			}]`,
			Lint.Utils.dedent`
			[true, {
				"order": [
					{
						"name": "static non-private",
						"kinds": [
							"public-static-field",
							"protected-static-field",
							"public-static-method",
							"protected-static-method"
						]
					},
					"constructor"
				]
			}]`,
		],
		type: 'typescript',
		typescriptOnly: false,
	};

	public static FAILURE_STRING_ALPHABETIZE(prevName: string, curName: string) {
		return `${show(curName)} should come alphabetically before ${show(prevName)}`;
		function show(s: string) {
			return s === '' ? 'Computed property' : `'${s}'`;
		}
	}

	public static FAILURE_STRING_REACT_LIFE_CYCLE_METHOD_ORDER(prevName: string, curName: string) {
		return `React lifecycle method ${curName} should come before ${prevName}.`;
	}

	/* tslint:enable:object-literal-sort-keys */
	public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
		return this.applyWithWalker(new MemberOrderingWalker(sourceFile, this.getOptions()));
	}
}

// tslint:disable-next-line:max-classes-per-file
export class MemberOrderingWalker extends Lint.RuleWalker {
	private inReactClass: boolean = false;
	private readonly opts: Options;

	constructor(sourceFile: ts.SourceFile, options: Lint.IOptions) {
		super(sourceFile, options);
		this.opts = parseOptions(this.getOptions() as any[]);
	}

	/** Finds the lowest lifecycle name higher than 'targetName'. */
	private findLowerLicecycleName(members: Member[], targetRank: Rank, targetName: ReactLifecycleMethodName): string {
		for (const member of members) {
			if (!member.name || this.memberRank(member, this.inReactClass).rank !== targetRank) {
				continue;
			}
			const name = nameString(member.name);
			if (this.lifecycleOrderLess(targetName, name as ReactLifecycleMethodName)) {
				return name;
			}
		}
		throw new Error('Expected to find a name');
	}

	/** Finds the lowest name higher than 'targetName'. */
	private findLowerName(members: Member[], targetRank: Rank, targetName: string): string {
		for (const member of members) {
			if (!member.name || this.memberRank(member, this.inReactClass).rank !== targetRank) {
				continue;
			}
			const name = nameString(member.name);
			if (caseInsensitiveLess(targetName, name)) {
				return name;
			}
		}
		throw new Error('Expected to find a name');
	}

	/** Finds the highest existing rank lower than `targetRank`. */
	private findLowerRank(members: Member[], targetRank: Rank): Rank | -1 {
		let max: Rank | -1 = -1;
		for (const member of members) {
			const { rank } = this.memberRank(member, this.inReactClass);
			if (rank !== -1 && rank < targetRank) {
				max = Math.max(max, rank);
			}
		}
		return max;
	}

	private isReactClass(node: ts.ClassLikeDeclaration): boolean {
		if (!node.heritageClauses || node.heritageClauses.length !== 1) {
			return false;
		}

		const clause = node.heritageClauses[0];

		if (clause.types == null) {
			return false;
		}

		const ancestor = clause.types[0];
		if (!ancestor) {
			return false;
		}

		return (
			/^(RelayComponent|Component|PureComponent|React.Component|React.PureComponent)($|<)/.
				test(ancestor.getText(this.getSourceFile()))
		);
	}

	private lifecycleMethodToOrder(lifecycleMethodName: ReactLifecycleMethodName): number {
		const idx = this.opts.lifecycleOrderings.indexOf(lifecycleMethodName);

		if (idx < 0) {
			throw new Error('Lifecycle method ' + lifecycleMethodName + ' not found');
		}

		return idx;
	}

	private lifecycleOrderLess(lhs: ReactLifecycleMethodName, rhs: ReactLifecycleMethodName): boolean {
		const lhsOrder = this.lifecycleMethodToOrder(lhs);
		const rhsOrder = this.lifecycleMethodToOrder(rhs);

		if (lhsOrder < rhsOrder) {
			return true;
		}
		return false;
	}

	private memberRank(member: Member, inReactClass: boolean): {
		isLifecycleMethod: boolean,
		rank: Rank | -1,
	} {
		const optionName = getMemberKind(member, inReactClass);
		if (optionName === undefined) {
			return {
				isLifecycleMethod: false,
				rank: -1,
			};
		}
		return {
			isLifecycleMethod: optionName === MemberKind.reactLifecycleMethod,
			rank: this.opts.order.findIndex((category) => category.has(optionName)),
		};
	}

	private rankName(rank: Rank): string {
		return this.opts.order[rank].name;
	}

	private sortMembers(members: Member[], inReactClass: boolean): string {
		// This shoves all unranked members to the bottom.
		// It might not be ideal but we are not using that kind of stuff.
		const cmp = (a: Member, b: Member): number => {
			const aRank = this.memberRank(a, inReactClass);
			const bRank = this.memberRank(b, inReactClass);

			if (aRank.rank < bRank.rank) {
				return -1;
			} else if (bRank.rank < aRank.rank) {
				return 1;
			}

			// Pray to god this is stable sort
			if (!this.opts.alphabetize || a.name == null || b.name == null) {
				return 0;
			}

			const aName = nameString(a.name);
			const bName = nameString(b.name);
			if (aRank.isLifecycleMethod) {
				if (
					this.lifecycleOrderLess(
						aName as ReactLifecycleMethodName,
						bName as ReactLifecycleMethodName,
					)
				) {
					return -1;
				}
				return 1;
			}

			if (caseInsensitiveLess(aName, bName)) {
				return -1;
			}
			return 1;
		};

		const sortedMembers = members.slice(0).sort(cmp);

		return sortedMembers.map(v => v.getFullText()).join('');
	}

	private visitMembers(members: ts.NodeArray<Member>) {
		let prevRank = -1;
		let prevName: string | undefined;

		const generateFix = () => {
			const sortedMembers = this.sortMembers(members, this.inReactClass);
			const start = members.pos;
			const width = members.end - start;
			return new Lint.Replacement(start, width, sortedMembers);
		};
		for (const member of members) {
			const { rank, isLifecycleMethod } = this.memberRank(member, this.inReactClass);
			if (rank === -1) {
				// no explicit ordering for this kind of node specified, so continue
				continue;
			}
			if (rank < prevRank) {
				const nodeType = this.rankName(rank);
				const prevNodeType = this.rankName(prevRank);
				const lowerRank = this.findLowerRank(members, rank);
				const locationHint = lowerRank !== -1
					? `after ${this.rankName(lowerRank)}s`
					: 'at the beginning of the class/interface';
				const errorLine1 = `Declaration of ${nodeType} not allowed after declaration of ${prevNodeType}. ` +
					`Instead, this should come ${locationHint}.`;
				this.addFailureAtNode(member, errorLine1, generateFix());
			} else {
				if (this.opts.alphabetize && member.name) {
					if (rank !== prevRank) {
						// No alphabetical ordering between different ranks
						prevName = undefined;
					}

					const curName = nameString(member.name);
					if (isLifecycleMethod) {
						if (prevName === undefined) {
							prevName = curName;
						} else {
							if (this.lifecycleOrderLess(curName as ReactLifecycleMethodName, prevName as ReactLifecycleMethodName)) {
								this.addFailureAtNode(
									member.name,
									Rule.FAILURE_STRING_REACT_LIFE_CYCLE_METHOD_ORDER(
										this.findLowerLicecycleName(members, rank, curName as ReactLifecycleMethodName),
										curName,
									),
									generateFix(),
								);
							} else {
								prevName = curName;
							}
						}
					} else {
						if (prevName !== undefined && caseInsensitiveLess(curName, prevName)) {
							this.addFailureAtNode(
								member.name,
								Rule.FAILURE_STRING_ALPHABETIZE(this.findLowerName(members, rank, curName), curName),
								generateFix(),
							);
						} else {
							prevName = curName;
						}
					}
				}

				// keep track of last good node
				prevRank = rank;
			}
		}
	}

	public visitClassDeclaration(node: ts.ClassDeclaration) {
		const originalInReactClass = this.inReactClass;
		this.inReactClass = this.isReactClass(node);
		this.visitMembers(node.members);
		super.visitClassDeclaration(node);
		this.inReactClass = originalInReactClass;
	}

	public visitClassExpression(node: ts.ClassExpression) {
		const originalInReactClass = this.inReactClass;
		this.inReactClass = this.isReactClass(node);
		this.visitMembers(node.members);
		super.visitClassExpression(node);
		this.inReactClass = originalInReactClass;
	}

	public visitInterfaceDeclaration(node: ts.InterfaceDeclaration) {
		const originalInReactClass = this.inReactClass;
		this.inReactClass = false;
		this.visitMembers(node.members);
		super.visitInterfaceDeclaration(node);
		this.inReactClass = originalInReactClass;
	}

	public visitObjectLiteralExpression(node: ts.ObjectLiteralExpression) {
		const originalInReactClass = this.inReactClass;
		this.inReactClass = false;
		super.visitObjectLiteralExpression(node);
		this.inReactClass = originalInReactClass;
	}

	public visitTypeLiteral(node: ts.TypeLiteralNode) {
		const originalInReactClass = this.inReactClass;
		this.inReactClass = false;
		this.visitMembers(node.members);
		this.inReactClass = originalInReactClass;
		super.visitTypeLiteral(node);
	}
}

function caseInsensitiveLess(a: string, b: string) {
	return a.toLowerCase() < b.toLowerCase();
}

function memberKindForConstructor(access: Access): MemberKind {
	return (MemberKind as any)[access + 'Constructor'] as MemberKind;
}

function memberKindForMethodOrField(
	access: Access,
	membership: 'Static' | 'Instance',
	kind: 'Method' | 'Field',
): MemberKind {
	return (MemberKind as any)[access + membership + kind] as MemberKind;
}

const allAccess: Access[] = ['public', 'protected', 'private'];

function memberKindFromName(name: string): MemberKind[] {
	const kind = (MemberKind as any)[Lint.Utils.camelize(name)];
	return typeof kind === 'number' ? [kind as MemberKind] : allAccess.map(addModifier);

	function addModifier(modifier: string) {
		const modifiedKind = (MemberKind as any)[Lint.Utils.camelize(modifier + '-' + name)];
		if (typeof modifiedKind !== 'number') {
			throw new Error(`Bad member kind: ${name}`);
		}
		return modifiedKind;
	}
}

type ReactLifecycleMethodName =
	'componentWillMount' |
	'componentDidMount' |
	'componentWillReceiveProps' |
	'shouldComponentUpdate' |
	'componentWillUpdate' |
	'componentDidUpdate' |
	'componentWillUnmount';

const reactLifecycleMethods: ReactLifecycleMethodName[] = [
	'componentWillMount',
	'componentDidMount',
	'componentWillReceiveProps',
	'shouldComponentUpdate',
	'componentWillUpdate',
	'componentDidUpdate',
	'componentWillUnmount',
];
function getMemberKind(member: Member, inReactClass: boolean): MemberKind | undefined {
	if (inReactClass) {
		if (
			member.kind === ts.SyntaxKind.MethodDeclaration ||
			member.kind === ts.SyntaxKind.MethodSignature
		) {
			const memberName = nameString((member as ts.MethodDeclaration | ts.MethodSignature).name);
			if (memberName === 'render') {
				return MemberKind.reactRenderMethod;
			}
			if (reactLifecycleMethods.indexOf(memberName as ReactLifecycleMethodName) >= 0) {
				return MemberKind.reactLifecycleMethod;
			}
		}
	}
	const accessLevel = hasModifier(ts.SyntaxKind.PrivateKeyword) ? 'private'
		: hasModifier(ts.SyntaxKind.ProtectedKeyword) ? 'protected'
			: 'public';

	switch (member.kind) {
		case ts.SyntaxKind.Constructor:
		case ts.SyntaxKind.ConstructSignature:
			return memberKindForConstructor(accessLevel);

		case ts.SyntaxKind.PropertyDeclaration:
		case ts.SyntaxKind.PropertySignature:
			return methodOrField(isFunctionLiteral((member as ts.PropertyDeclaration).initializer));

		case ts.SyntaxKind.MethodDeclaration:
		case ts.SyntaxKind.MethodSignature:
			return methodOrField(true);

		default:
			return undefined;
	}

	function methodOrField(isMethod: boolean) {
		const membership = hasModifier(ts.SyntaxKind.StaticKeyword) ? 'Static' : 'Instance';
		return memberKindForMethodOrField(accessLevel, membership, isMethod ? 'Method' : 'Field');
	}

	function hasModifier(kind: ts.SyntaxKind) {
		return Lint.hasModifier(member.modifiers, kind);
	}
}

type MemberCategoryJson = {
	kinds: string[];
	name: string;
} | string;
// tslint:disable-next-line:max-classes-per-file
class MemberCategory {
	constructor(readonly name: string, private readonly kinds: Set<MemberKind>) { }

	public has(kind: MemberKind) { return this.kinds.has(kind); }
}

type Member = ts.TypeElement | ts.ClassElement;
type Rank = number;

type Access = 'public' | 'protected' | 'private';

interface Options {
	alphabetize: boolean;
	lifecycleOrderings: ReactLifecycleMethodName[];
	order: MemberCategory[];
}

function parseOptions(options: any[]): Options {
	const { order: orderJson, alphabetize, lifecycleOrderings } = getOptionsJson(options);
	const order = orderJson.map((cat) => typeof cat === 'string'
		? new MemberCategory(cat.replace(/-/g, ' '), new Set(memberKindFromName(cat)))
		: new MemberCategory(cat.name, new Set(flatMap(cat.kinds, memberKindFromName))));
	return { order, alphabetize, lifecycleOrderings };
}
function getOptionsJson(allOptions: any[]): {
	alphabetize: boolean,
	lifecycleOrderings: ReactLifecycleMethodName[],
	order: MemberCategoryJson[],
} {
	if (allOptions == null || allOptions.length === 0 || allOptions[0] == null) {
		throw new Error('Got empty options');
	}

	const firstOption = allOptions[0] as Options | string;
	if (typeof firstOption !== 'object') {
		// Undocumented direct string option. Deprecate eventually.
		return {
			alphabetize: false,
			lifecycleOrderings: reactLifecycleMethods,
			order: convertFromOldStyleOptions(allOptions),
		}; // presume allOptions to be string[]
	}

	return {
		alphabetize: !!firstOption[OPTION_ALPHABETIZE],
		lifecycleOrderings: lifecycleOrderingsFromOption(firstOption[OPTION_LIFECYCLEORDERINGS]),
		order: categoryFromOption(firstOption[OPTION_ORDER]),
	};
}
function categoryFromOption(orderOption: {}): MemberCategoryJson[] {
	if (Array.isArray(orderOption)) {
		return orderOption;
	}

	const preset = PRESETS.get(orderOption as string);
	if (!preset) {
		throw new Error(`Bad order: ${JSON.stringify(orderOption)}`);
	}
	return preset;
}

function lifecycleOrderingsFromOption(opts: any): ReactLifecycleMethodName[] {
	if (opts == null) {
		return reactLifecycleMethods.slice(0);
	}
	if (!Array.isArray(opts)) {
		throw new Error(
			`${OPTION_LIFECYCLEORDERINGS} must be an array consisting of values ${reactLifecycleMethods.join(', ')}`,
		);
	}

	if (opts.find(v => typeof (v) !== 'string')) {
		throw new Error(
			`${OPTION_LIFECYCLEORDERINGS} must be an array consisting of values ${reactLifecycleMethods.join(', ')}`,
		);
	}

	const options = new Set(opts);
	if (options.size !== opts.length) {
		throw new Error(`${OPTION_LIFECYCLEORDERINGS} must have unique values`);
	}

	if (opts.length !== reactLifecycleMethods.length) {
		throw new Error(
			`${OPTION_LIFECYCLEORDERINGS} must be an array consisting of values ${reactLifecycleMethods.join(', ')}`,
		);
	}

	return opts;
}

/**
 * Convert from undocumented old-style options.
 * This is designed to mimic the old behavior and should be removed eventually.
 */
function convertFromOldStyleOptions(options: string[]): MemberCategoryJson[] {
	let categories: NameAndKinds[] = [{ name: 'member', kinds: allMemberKindNames }];
	if (hasOption('variables-before-functions')) {
		categories = splitOldStyleOptions(categories, (kind) => kind.includes('field'), 'field', 'method');
	}
	if (hasOption('static-before-instance')) {
		categories = splitOldStyleOptions(categories, (kind) => kind.includes('static'), 'static', 'instance');
	}
	if (hasOption('public-before-private')) {
		// 'protected' is considered public
		categories = splitOldStyleOptions(categories, (kind) => !kind.includes('private'), 'public', 'private');
	}
	return categories;

	function hasOption(x: string): boolean {
		return options.indexOf(x) !== -1;
	}
}
interface NameAndKinds { kinds: string[]; name: string; }
function splitOldStyleOptions(
	categories: NameAndKinds[],
	filter: (name: string) => boolean,
	a: string,
	b: string,
): NameAndKinds[] {
	const newCategories: NameAndKinds[] = [];
	for (const cat of categories) {
		const yes = []; const no = [];
		for (const kind of cat.kinds) {
			if (filter(kind)) {
				yes.push(kind);
			} else {
				no.push(kind);
			}
		}
		const augmentName = (s: string) => {
			if (a === 'field') {
				// Replace "member" with "field"/"method" instead of augmenting.
				return s;
			}
			return `${s} ${cat.name}`;
		};
		newCategories.push({ name: augmentName(a), kinds: yes });
		newCategories.push({ name: augmentName(b), kinds: no });
	}
	return newCategories;
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

function nameString(name: ts.PropertyName): string {
	switch (name.kind) {
		case ts.SyntaxKind.Identifier:
		case ts.SyntaxKind.StringLiteral:
		case ts.SyntaxKind.NumericLiteral:
			return (name as ts.Identifier | ts.LiteralExpression).text;
		default:
			return '';
	}
}
