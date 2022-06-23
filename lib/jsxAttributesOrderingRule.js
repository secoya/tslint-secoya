"use strict";
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    }
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var Lint = require("tslint");
var ts = require("typescript");
var optionsDescription = Lint.Utils.dedent(templateObject_1 || (templateObject_1 = __makeTemplateObject(["\n\tEnforces alphabetical ordering of JSX attributes"], ["\n\tEnforces alphabetical ordering of JSX attributes"])));
var Rule = /** @class */ (function (_super) {
    __extends(Rule, _super);
    function Rule() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    /* tslint:enable:object-literal-sort-keys */
    Rule.FAILURE_STRING_ALPHABETIZE = function (prevName, curName) {
        return show(curName) + " should come alphabetically before " + show(prevName) + ".";
        function show(s) {
            return "'" + s + "'";
        }
    };
    Rule.prototype.apply = function (sourceFile) {
        return this.applyWithWalker(new JSXAttributesOrderingWalker(sourceFile, this.getOptions()));
    };
    /* tslint:disable:object-literal-sort-keys */
    Rule.metadata = {
        ruleName: 'jsx-attributes-ordering',
        description: 'Enforces attribute ordering in jsx elements ',
        rationale: "Alphabetical ordering of attributes means that there's a predictable ordering",
        optionsDescription: optionsDescription,
        options: null,
        type: 'maintainability',
        typescriptOnly: false,
    };
    return Rule;
}(Lint.Rules.AbstractRule));
exports.Rule = Rule;
function attributeNameComparator(a, b) {
    var aName = getAttributeName(a);
    var bName = getAttributeName(b);
    // We assume they will never be equal, this might be a bad idea to assume though
    return caseInsensitiveLess(aName, bName) ? -1 : 1;
}
var JSXAttributesOrderingWalker = /** @class */ (function (_super) {
    __extends(JSXAttributesOrderingWalker, _super);
    function JSXAttributesOrderingWalker(sourceFile, options) {
        return _super.call(this, sourceFile, options) || this;
    }
    JSXAttributesOrderingWalker.prototype.getFix = function (node) {
        if (node.kind === ts.SyntaxKind.JsxElement) {
            return this.getJsxElementFix(node);
        }
        return this.getJsxSelfClosingElementFix(node);
    };
    JSXAttributesOrderingWalker.prototype.getJsxElementFix = function (node) {
        var attributes = node.openingElement.attributes;
        var sortedAttributes = this.getSortedAttributes(attributes);
        var start = attributes.pos;
        var width = attributes.end - start;
        return new Lint.Replacement(start, width, sortedAttributes);
    };
    JSXAttributesOrderingWalker.prototype.getJsxSelfClosingElementFix = function (node) {
        var attributes = node.attributes;
        var sortedAttributes = this.getSortedAttributes(attributes);
        var start = attributes.pos;
        var width = attributes.end - start;
        return new Lint.Replacement(start, width, sortedAttributes);
    };
    JSXAttributesOrderingWalker.prototype.getSortedAttributes = function (unsortedAttributes) {
        var attributes = [];
        var groupAttributes = [];
        for (var _i = 0, _a = unsortedAttributes.properties; _i < _a.length; _i++) {
            var attrib = _a[_i];
            if (attrib.kind === ts.SyntaxKind.JsxSpreadAttribute) {
                if (groupAttributes.length > 0) {
                    groupAttributes.sort(attributeNameComparator);
                    attributes.splice.apply(attributes, [attributes.length, 0].concat(groupAttributes));
                    groupAttributes = [];
                }
                attributes.push(attrib);
                continue;
            }
            groupAttributes.push(attrib);
        }
        if (groupAttributes.length > 0) {
            groupAttributes.sort(attributeNameComparator);
            attributes.splice.apply(attributes, [attributes.length, 0].concat(groupAttributes));
        }
        return attributes.map(function (v) { return v.getFullText(); }).join('');
    };
    JSXAttributesOrderingWalker.prototype.visitAttributeList = function (nodes, containingNode) {
        var groupAttributes = [];
        for (var _i = 0, _a = nodes.properties; _i < _a.length; _i++) {
            var node = _a[_i];
            // When doing spreads we need to reset the alphabetical ordering
            if (node.kind === ts.SyntaxKind.JsxSpreadAttribute) {
                groupAttributes = [];
                continue;
            }
            var attribNode = node;
            if (groupAttributes.length === 0) {
                // Only attribute in group? It's good
                groupAttributes.push(attribNode);
                continue;
            }
            var attribName = getAttributeName(attribNode);
            var lastAttribName = getAttributeName(groupAttributes[groupAttributes.length - 1]);
            if (caseInsensitiveLess(attribName, lastAttribName)) {
                this.addFailureAtNode(attribNode.name, Rule.FAILURE_STRING_ALPHABETIZE(findLowerName(attribName, groupAttributes), attribName), this.getFix(containingNode));
            }
            else {
                groupAttributes.push(attribNode);
            }
        }
    };
    JSXAttributesOrderingWalker.prototype.visitJsxElement = function (node) {
        this.visitAttributeList(node.openingElement.attributes, node);
        _super.prototype.visitJsxElement.call(this, node);
    };
    JSXAttributesOrderingWalker.prototype.visitJsxSelfClosingElement = function (node) {
        this.visitAttributeList(node.attributes, node);
        _super.prototype.visitJsxSelfClosingElement.call(this, node);
    };
    return JSXAttributesOrderingWalker;
}(Lint.RuleWalker));
exports.JSXAttributesOrderingWalker = JSXAttributesOrderingWalker;
function getAttributeName(attrib) {
    return attrib.name.text;
}
// Finds the element in groupAttributes that name should be inserted before
function findLowerName(targetName, groupAttributes) {
    for (var _i = 0, groupAttributes_1 = groupAttributes; _i < groupAttributes_1.length; _i++) {
        var attribute = groupAttributes_1[_i];
        var name = getAttributeName(attribute);
        if (caseInsensitiveLess(targetName, name)) {
            return name;
        }
    }
    throw new Error('Expected to find a name');
}
function caseInsensitiveLess(a, b) {
    return a.toLowerCase() < b.toLowerCase();
}
var templateObject_1;
