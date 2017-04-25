import * as ts from 'typescript';

import * as Lint from 'tslint';
import { flatMap, mapDefined } from 'tslint/lib/utils';

const optionsDescription = Lint.Utils.dedent`
    Enforces alphabetical ordering of JSX attributes`;

export class Rule extends Lint.Rules.AbstractRule {
	/* tslint:disable:object-literal-sort-keys */
	public static metadata: Lint.IRuleMetadata = {
		ruleName: 'jsx-attributes-ordering',
		description: 'Enforces attribute ordering in jsx elements ',
		rationale: 'Alphabetical ordering of attributes means that there\'s a predictable ordering',
		optionsDescription,
		options: null,
		type: 'maintainability',
		typescriptOnly: false,
	};
	/* tslint:enable:object-literal-sort-keys */

	public static FAILURE_STRING_ALPHABETIZE(prevName: string, curName: string) {
		return `${show(curName)} should come alphabetically before ${show(prevName)}.`;
		function show(s: string) {
			return `'${s}'`;
		}
	}

	public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
		return this.applyWithWalker(new JSXAttributesOrderingWalker(sourceFile, this.getOptions()));
	}
}

function attributeNameComparator(a: ts.JsxAttribute, b: ts.JsxAttribute) {
	const aName = getAttributeName(a);
	const bName = getAttributeName(b);
	// We assume they will never be equal, this might be a bad idea to assume though
	return caseInsensitiveLess(aName, bName) ? -1 : 1;
}

// tslint:disable-next-line:max-classes-per-file
export class JSXAttributesOrderingWalker extends Lint.RuleWalker {
	constructor(sourceFile: ts.SourceFile, options: Lint.IOptions) {
		super(sourceFile, options);
	}

	private getFix(node: ts.JsxElement | ts.JsxSelfClosingElement): Lint.Fix {
		if (node.kind === ts.SyntaxKind.JsxElement) {
			return this.getJsxElementFix(node as ts.JsxElement);
		}
		return this.getJsxSelfClosingElementFix(node as ts.JsxSelfClosingElement);
	}

	private getJsxElementFix(node: ts.JsxElement): Lint.Fix {
		const attributes = node.openingElement.attributes;
		const sortedAttributes = this.getSortedAttributes(attributes);

		const start = attributes.pos;
		const width = attributes.end - start;
		return new Lint.Replacement(
			start,
			width,
			sortedAttributes,
		);
	}

	private getJsxSelfClosingElementFix(node: ts.JsxSelfClosingElement): Lint.Fix {
		const attributes = node.attributes;
		const sortedAttributes = this.getSortedAttributes(attributes);

		const start = attributes.pos;
		const width = attributes.end - start;
		return new Lint.Replacement(
			start,
			width,
			sortedAttributes,
		);
	}

	private getSortedAttributes(unsortedAttributes: ts.JsxAttributeLike[]): string {
		const attributes: ts.JsxAttributeLike[] = [];
		let groupAttributes: ts.JsxAttribute[] = [];
		for (const attrib of unsortedAttributes) {
			if (attrib.kind === ts.SyntaxKind.JsxSpreadAttribute) {
				if (groupAttributes.length > 0) {
					groupAttributes.sort(attributeNameComparator);
					attributes.splice(attributes.length, 0, ...groupAttributes);
					groupAttributes = [];
				}
				attributes.push(attrib);
				continue;
			}
			groupAttributes.push(attrib);
		}
		if (groupAttributes.length > 0) {
			groupAttributes.sort(attributeNameComparator);
			attributes.splice(attributes.length, 0, ...groupAttributes);
		}

		return attributes.map(v => v.getFullText()).join('');
	}

	private visitAttributeList(
		nodes: ts.NodeArray<ts.JsxAttribute | ts.JsxSpreadAttribute>,
		containingNode: ts.JsxElement | ts.JsxSelfClosingElement,
	) {
		let groupAttributes: ts.JsxAttribute[] = [];

		for (const node of nodes) {
			// When doing spreads we need to reset the alphabetical ordering
			if (node.kind === ts.SyntaxKind.JsxSpreadAttribute) {
				groupAttributes = [];
				continue;
			}

			const attribNode = node as ts.JsxAttribute;
			if (groupAttributes.length === 0) {
				// Only attribute in group? It's good
				groupAttributes.push(attribNode);
				continue;
			}

			const attribName = getAttributeName(attribNode);
			const lastAttribName = getAttributeName(groupAttributes[groupAttributes.length - 1]);

			if (caseInsensitiveLess(attribName, lastAttribName)) {
				this.addFailureAtNode(
					attribNode.name,
					Rule.FAILURE_STRING_ALPHABETIZE(
						findLowerName(
							attribName,
							groupAttributes,
						),
						attribName,
					),
					this.getFix(containingNode),
				);
			} else {
				groupAttributes.push(attribNode);
			}
		}
	}

	protected visitJsxElement(node: ts.JsxElement): void {
		this.visitAttributeList(node.openingElement.attributes, node);
		super.visitJsxElement(node);
	}

	protected visitJsxSelfClosingElement(node: ts.JsxSelfClosingElement): void {
		this.visitAttributeList(node.attributes, node);
		super.visitJsxSelfClosingElement(node);
	}
}

function getAttributeName(attrib: ts.JsxAttribute): string {
	return attrib.name.text;
}

// Finds the element in groupAttributes that name should be inserted before
function findLowerName(targetName: string, groupAttributes: ts.JsxAttribute[]): string {
	for (const attribute of groupAttributes) {
		const name = getAttributeName(attribute);
		if (caseInsensitiveLess(targetName, name)) {
			return name;
		}
	}
	throw new Error('Expected to find a name');
}

function caseInsensitiveLess(a: string, b: string) {
	return a.toLowerCase() < b.toLowerCase();
}
