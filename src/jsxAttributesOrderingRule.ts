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

	public static FAILURE_STRING_ALPHABETIZE(prevName: string, curName: string) {
		return `${show(curName)} should come alphabetically before ${show(prevName)}.`;
		function show(s: string) {
			return `'${s}'`;
		}
	}

	/* tslint:enable:object-literal-sort-keys */
	public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
		return this.applyWithWalker(new JSXAttributesOrderingWalker(sourceFile, this.getOptions()));
	}
}

// tslint:disable-next-line:max-classes-per-file
export class JSXAttributesOrderingWalker extends Lint.RuleWalker {
	constructor(sourceFile: ts.SourceFile, options: Lint.IOptions) {
		super(sourceFile, options);
	}

	private visitAttributeList(nodes: ts.NodeArray<ts.JsxAttribute | ts.JsxSpreadAttribute>) {
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
				);
			} else {
				groupAttributes.push(attribNode);
			}
		}
	}

	protected visitJsxElement(node: ts.JsxElement): void {
		this.visitAttributeList(node.openingElement.attributes);
		super.visitJsxElement(node);
	}

	protected visitJsxSelfClosingElement(node: ts.JsxSelfClosingElement): void {
		this.visitAttributeList(node.attributes);
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
