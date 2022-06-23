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
var optionsDescription = Lint.Utils.dedent(templateObject_1 || (templateObject_1 = __makeTemplateObject(["\n    Enforces consistent formatting of class members. Namely\n      * No extra leading new line before first member.\n      * No extra tailing new line after last member.\n      * All field variables within same visibility and static/instance type must not be separated with extra new lines.\n\t  * Anything else should have extra new line sepration."], ["\n    Enforces consistent formatting of class members. Namely\n      * No extra leading new line before first member.\n      * No extra tailing new line after last member.\n      * All field variables within same visibility and static/instance type must not be separated with extra new lines.\n\t  * Anything else should have extra new line sepration."])));
var Rule = /** @class */ (function (_super) {
    __extends(Rule, _super);
    function Rule() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    /* tslint:enable:object-literal-sort-keys */
    Rule.prototype.apply = function (sourceFile) {
        return this.applyWithWalker(new WhitespacingWalker(sourceFile, this.getOptions()));
    };
    /* tslint:disable:object-literal-sort-keys */
    Rule.metadata = {
        ruleName: 'class-members-whitespacing',
        description: 'Enforces consistent formatting of class members.',
        rationale: 'Consistent formatting.',
        optionsDescription: optionsDescription,
        options: null,
        type: 'maintainability',
        typescriptOnly: false,
    };
    return Rule;
}(Lint.Rules.AbstractRule));
exports.Rule = Rule;
var WhitespacingWalker = /** @class */ (function (_super) {
    __extends(WhitespacingWalker, _super);
    function WhitespacingWalker(sourceFile, options) {
        return _super.call(this, sourceFile, options) || this;
    }
    WhitespacingWalker.prototype.makeFixWithOneLeadingNewLines = function (node) {
        var trivia = leadingTriviaText(node);
        var hasNewLines = substringCount(trivia, '\n');
        if (!hasNewLines) {
            return Lint.Replacement.replaceFromTo(node.getFullStart(), node.getStart(), '\n' + trivia);
        }
        var replacement = replaceBlankLinesWith(node, '\n');
        return Lint.Replacement.replaceFromTo(node.getFullStart(), node.getStart(), replacement);
    };
    WhitespacingWalker.prototype.makeFixWithTwoLeadingNewLines = function (node) {
        var trivia = leadingTriviaText(node);
        var hasNewLines = substringCount(trivia, '\n');
        if (!hasNewLines) {
            return Lint.Replacement.replaceFromTo(node.getFullStart(), node.getStart(), '\n\n' + trivia);
        }
        var replacementOneNewLine = replaceBlankLinesWith(node, '\n');
        var firstNewLine = trivia.indexOf('\n');
        var replacement = replacementOneNewLine.substring(0, firstNewLine) + '\n' + replacementOneNewLine.substring(firstNewLine);
        return Lint.Replacement.replaceFromTo(node.getFullStart(), node.getStart(), replacement);
    };
    WhitespacingWalker.prototype.visitClassMembers = function (members, endClassToken) {
        if (members.length === 0 || endClassToken == null) {
            return;
        }
        var firstMember = members[0];
        if (hasAtLeastOneBlankLine(firstMember)) {
            this.addFailureAtNode(firstMember, 'Expected no extranous leading new line', this.makeFixWithOneLeadingNewLines(firstMember));
        }
        else if (substringCount(leadingTriviaText(endClassToken), '\n') === 0) {
            this.addFailureAtNode(firstMember, 'Expected a single leading new line', this.makeFixWithOneLeadingNewLines(firstMember));
        }
        if (hasAtLeastOneBlankLine(endClassToken)) {
            this.addFailureAtNode(endClassToken, 'Expected no extranous leading new line', this.makeFixWithOneLeadingNewLines(endClassToken));
        }
        else if (substringCount(leadingTriviaText(endClassToken), '\n') === 0) {
            this.addFailureAtNode(endClassToken, 'Expected a single leading new line', this.makeFixWithOneLeadingNewLines(endClassToken));
        }
        var lastMembeKind = getMemberKind(firstMember);
        for (var i = 1; i < members.length; i++) {
            var member = members[i];
            var memberKind = getMemberKind(member);
            if (lastMembeKind !== memberKind || memberKind === 'constructor' || memberKind === 'method') {
                if (hasNoBlankLines(member)) {
                    this.addFailureAtNode(member, 'Expected two leading new lines', this.makeFixWithTwoLeadingNewLines(member));
                }
                else if (countBlankLines(member) !== 1) {
                    this.addFailureAtNode(member, 'Expected two leading new lines', this.makeFixWithTwoLeadingNewLines(member));
                }
            }
            else {
                if (!hasNoBlankLines(member)) {
                    this.addFailureAtNode(member, 'Expected a single leading new line', this.makeFixWithOneLeadingNewLines(member));
                }
            }
            lastMembeKind = memberKind;
        }
    };
    WhitespacingWalker.prototype.visitClassDeclaration = function (node) {
        _super.prototype.visitClassDeclaration.call(this, node);
        this.visitClassMembers(node.members, node.getLastToken());
    };
    WhitespacingWalker.prototype.visitClassExpression = function (node) {
        _super.prototype.visitClassExpression.call(this, node);
        this.visitClassMembers(node.members, node.getLastToken());
    };
    return WhitespacingWalker;
}(Lint.RuleWalker));
exports.WhitespacingWalker = WhitespacingWalker;
function getMemberKind(member) {
    var accessLevel = hasModifier(ts.SyntaxKind.PrivateKeyword)
        ? 'private'
        : hasModifier(ts.SyntaxKind.ProtectedKeyword)
            ? 'protected'
            : 'public';
    switch (member.kind) {
        case ts.SyntaxKind.Constructor:
        case ts.SyntaxKind.ConstructSignature:
            return 'constructor';
        case ts.SyntaxKind.PropertyDeclaration:
        case ts.SyntaxKind.PropertySignature:
            return methodOrField(isFunctionLiteral(member.initializer));
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.MethodSignature:
            return methodOrField(true);
        default:
            return 'method';
    }
    function methodOrField(isMethod) {
        var membership = hasModifier(ts.SyntaxKind.StaticKeyword) ? 'Static' : 'Instance';
        return memberKindForMethodOrField(accessLevel, membership, isMethod ? 'Method' : 'Field');
    }
    function hasModifier(kind) {
        return Lint.hasModifier(member.modifiers, kind);
    }
}
function isFunctionLiteral(node) {
    switch (node && node.kind) {
        case ts.SyntaxKind.ArrowFunction:
        case ts.SyntaxKind.FunctionExpression:
            return true;
        default:
            return false;
    }
}
function memberKindForMethodOrField(access, membership, kind) {
    if (kind === 'Field') {
        return (access + (membership === 'Static' ? '-static' : '') + 'field');
    }
    return 'method';
}
function leadingTriviaText(node) {
    var fullText = node.getFullText();
    var triviaLength = node.getStart() - node.getFullStart();
    return fullText.substring(0, triviaLength);
}
function countBlankLines(node) {
    var regex = /(\n|\r)( |\t)*(\r|\n)/g;
    var count = 0;
    var trivia = leadingTriviaText(node);
    var found;
    // This is so much easier to read & write to be quite honest
    // tslint:disable-next-line:no-conditional-assignment
    while ((found = regex.exec(trivia)) != null) {
        count++;
        regex.lastIndex -= found[0].length - 1;
    }
    return count;
}
function replaceBlankLinesWith(node, replacementString) {
    return leadingTriviaText(node).replace(/(\n|\r)(( |\t)*(\r|\n))+/g, replacementString);
}
function hasAtLeastOneBlankLine(node) {
    return countBlankLines(node) >= 1;
}
function hasNoBlankLines(node) {
    return countBlankLines(node) === 0;
}
function substringCount(str, subString) {
    if (subString.length <= 0) {
        return str.length + 1;
    }
    var n = 0;
    var pos = 0;
    var step = subString.length;
    while (true) {
        pos = str.indexOf(subString, pos);
        if (pos >= 0) {
            ++n;
            pos += step;
        }
        else {
            break;
        }
    }
    return n;
}
var templateObject_1;
