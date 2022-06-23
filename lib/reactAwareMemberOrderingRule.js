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
var Lint = require("tslint");
var utils_1 = require("tslint/lib/utils");
var ts = require("typescript");
var OPTION_ORDER = 'order';
var OPTION_ALPHABETIZE = 'alphabetize';
var OPTION_LIFECYCLEORDERINGS = 'lifecycleOrderings';
var MemberKind;
(function (MemberKind) {
    MemberKind[MemberKind["publicStaticField"] = 0] = "publicStaticField";
    MemberKind[MemberKind["publicStaticMethod"] = 1] = "publicStaticMethod";
    MemberKind[MemberKind["protectedStaticField"] = 2] = "protectedStaticField";
    MemberKind[MemberKind["protectedStaticMethod"] = 3] = "protectedStaticMethod";
    MemberKind[MemberKind["privateStaticField"] = 4] = "privateStaticField";
    MemberKind[MemberKind["privateStaticMethod"] = 5] = "privateStaticMethod";
    MemberKind[MemberKind["publicInstanceField"] = 6] = "publicInstanceField";
    MemberKind[MemberKind["protectedInstanceField"] = 7] = "protectedInstanceField";
    MemberKind[MemberKind["privateInstanceField"] = 8] = "privateInstanceField";
    MemberKind[MemberKind["publicConstructor"] = 9] = "publicConstructor";
    MemberKind[MemberKind["protectedConstructor"] = 10] = "protectedConstructor";
    MemberKind[MemberKind["privateConstructor"] = 11] = "privateConstructor";
    MemberKind[MemberKind["publicInstanceMethod"] = 12] = "publicInstanceMethod";
    MemberKind[MemberKind["protectedInstanceMethod"] = 13] = "protectedInstanceMethod";
    MemberKind[MemberKind["privateInstanceMethod"] = 14] = "privateInstanceMethod";
    MemberKind[MemberKind["reactLifecycleMethod"] = 15] = "reactLifecycleMethod";
    MemberKind[MemberKind["reactRenderMethod"] = 16] = "reactRenderMethod";
})(MemberKind || (MemberKind = {}));
var PRESETS = new Map([
    [
        'fields-first',
        [
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
        ],
    ],
    [
        'instance-sandwich',
        [
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
        ],
    ],
    [
        'statics-first',
        [
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
        ],
    ],
]);
var PRESET_NAMES = Array.from(PRESETS.keys());
var allMemberKindNames = utils_1.mapDefined(Object.keys(MemberKind), function (key) {
    var mk = MemberKind[key];
    return typeof mk === 'number' ? MemberKind[mk].replace(/[A-Z]/g, function (cap) { return '-' + cap.toLowerCase(); }) : undefined;
});
function namesMarkdown(names) {
    return names.map(function (name) { return '* `' + name + '`'; }).join('\n    ');
}
var optionsDescription = Lint.Utils.dedent(templateObject_1 || (templateObject_1 = __makeTemplateObject(["\n    One argument, which is an object, must be provided. It should contain an `order` property.\n    The `order` property should have a value of one of the following strings:\n    ", "\n    Alternatively, the value for `order` maybe be an array consisting of the following strings:\n    ", "\n    You can also omit the access modifier to refer to \"public-\", \"protected-\", and \"private-\" all at once;\n    for example, \"static-field\".\n    You can also make your own categories by using an object instead of a string:\n        {\n            \"name\": \"static non-private\",\n            \"kinds\": [\n                \"public-static-field\",\n                \"protected-static-field\",\n                \"public-static-method\",\n                \"protected-static-method\"\n            ]\n        }\n    The '", "' option will enforce that members within the same category\n    should be alphabetically sorted by name."], ["\n    One argument, which is an object, must be provided. It should contain an \\`order\\` property.\n    The \\`order\\` property should have a value of one of the following strings:\n    ", "\n    Alternatively, the value for \\`order\\` maybe be an array consisting of the following strings:\n    ", "\n    You can also omit the access modifier to refer to \"public-\", \"protected-\", and \"private-\" all at once;\n    for example, \"static-field\".\n    You can also make your own categories by using an object instead of a string:\n        {\n            \"name\": \"static non-private\",\n            \"kinds\": [\n                \"public-static-field\",\n                \"protected-static-field\",\n                \"public-static-method\",\n                \"protected-static-method\"\n            ]\n        }\n    The '", "' option will enforce that members within the same category\n    should be alphabetically sorted by name."])), namesMarkdown(PRESET_NAMES), namesMarkdown(allMemberKindNames), OPTION_ALPHABETIZE);
var Rule = /** @class */ (function (_super) {
    __extends(Rule, _super);
    function Rule() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    Rule.FAILURE_STRING_ALPHABETIZE = function (prevName, curName) {
        return show(curName) + " should come alphabetically before " + show(prevName);
        function show(s) {
            return s === '' ? 'Computed property' : "'" + s + "'";
        }
    };
    Rule.FAILURE_STRING_REACT_LIFE_CYCLE_METHOD_ORDER = function (prevName, curName) {
        return "React lifecycle method " + curName + " should come before " + prevName + ".";
    };
    /* tslint:enable:object-literal-sort-keys */
    Rule.prototype.apply = function (sourceFile) {
        return this.applyWithWalker(new MemberOrderingWalker(sourceFile, this.getOptions()));
    };
    /* tslint:disable:object-literal-sort-keys */
    Rule.metadata = {
        ruleName: 'react-aware-member-ordering',
        description: 'Enforces member ordering. Also with special handling of react methods.',
        rationale: 'A consistent ordering for class members can make classes easier to read, navigate, and edit.',
        optionsDescription: optionsDescription,
        options: {
            type: 'object',
            properties: {
                order: {
                    oneOf: [
                        {
                            type: 'string',
                            enum: PRESET_NAMES,
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                                enum: allMemberKindNames,
                            },
                            maxLength: 13,
                        },
                    ],
                },
            },
            additionalProperties: false,
        },
        optionExamples: [
            '[true, { "order": "fields-first" }]',
            Lint.Utils.dedent(templateObject_2 || (templateObject_2 = __makeTemplateObject(["\n\t\t\t[true, {\n\t\t\t\t\"order\": [\n\t\t\t\t\t\"static-field\",\n\t\t\t\t\t\"instance-field\",\n\t\t\t\t\t\"constructor\",\n\t\t\t\t\t\"public-instance-method\",\n\t\t\t\t\t\"protected-instance-method\",\n\t\t\t\t\t\"private-instance-method\"\n\t\t\t\t]\n\t\t\t}]"], ["\n\t\t\t[true, {\n\t\t\t\t\"order\": [\n\t\t\t\t\t\"static-field\",\n\t\t\t\t\t\"instance-field\",\n\t\t\t\t\t\"constructor\",\n\t\t\t\t\t\"public-instance-method\",\n\t\t\t\t\t\"protected-instance-method\",\n\t\t\t\t\t\"private-instance-method\"\n\t\t\t\t]\n\t\t\t}]"]))),
            Lint.Utils.dedent(templateObject_3 || (templateObject_3 = __makeTemplateObject(["\n\t\t\t[true, {\n\t\t\t\t\"order\": [\n\t\t\t\t\t{\n\t\t\t\t\t\t\"name\": \"static non-private\",\n\t\t\t\t\t\t\"kinds\": [\n\t\t\t\t\t\t\t\"public-static-field\",\n\t\t\t\t\t\t\t\"protected-static-field\",\n\t\t\t\t\t\t\t\"public-static-method\",\n\t\t\t\t\t\t\t\"protected-static-method\"\n\t\t\t\t\t\t]\n\t\t\t\t\t},\n\t\t\t\t\t\"constructor\"\n\t\t\t\t]\n\t\t\t}]"], ["\n\t\t\t[true, {\n\t\t\t\t\"order\": [\n\t\t\t\t\t{\n\t\t\t\t\t\t\"name\": \"static non-private\",\n\t\t\t\t\t\t\"kinds\": [\n\t\t\t\t\t\t\t\"public-static-field\",\n\t\t\t\t\t\t\t\"protected-static-field\",\n\t\t\t\t\t\t\t\"public-static-method\",\n\t\t\t\t\t\t\t\"protected-static-method\"\n\t\t\t\t\t\t]\n\t\t\t\t\t},\n\t\t\t\t\t\"constructor\"\n\t\t\t\t]\n\t\t\t}]"]))),
        ],
        type: 'typescript',
        typescriptOnly: false,
    };
    return Rule;
}(Lint.Rules.AbstractRule));
exports.Rule = Rule;
var MemberOrderingWalker = /** @class */ (function (_super) {
    __extends(MemberOrderingWalker, _super);
    function MemberOrderingWalker(sourceFile, options) {
        var _this = _super.call(this, sourceFile, options) || this;
        _this.inReactClass = false;
        _this.opts = parseOptions(_this.getOptions());
        return _this;
    }
    /** Finds the lowest lifecycle name higher than 'targetName'. */
    MemberOrderingWalker.prototype.findLowerLicecycleName = function (members, targetRank, targetName) {
        for (var _i = 0, members_1 = members; _i < members_1.length; _i++) {
            var member = members_1[_i];
            if (!member.name || this.memberRank(member, this.inReactClass).rank !== targetRank) {
                continue;
            }
            var name = nameString(member.name);
            if (this.lifecycleOrderLess(targetName, name)) {
                return name;
            }
        }
        throw new Error('Expected to find a name');
    };
    /** Finds the lowest name higher than 'targetName'. */
    MemberOrderingWalker.prototype.findLowerName = function (members, targetRank, targetName) {
        for (var _i = 0, members_2 = members; _i < members_2.length; _i++) {
            var member = members_2[_i];
            if (!member.name || this.memberRank(member, this.inReactClass).rank !== targetRank) {
                continue;
            }
            var name = nameString(member.name);
            if (caseInsensitiveLess(targetName, name)) {
                return name;
            }
        }
        throw new Error('Expected to find a name');
    };
    /** Finds the highest existing rank lower than `targetRank`. */
    MemberOrderingWalker.prototype.findLowerRank = function (members, targetRank) {
        var max = -1;
        for (var _i = 0, members_3 = members; _i < members_3.length; _i++) {
            var member = members_3[_i];
            var rank = this.memberRank(member, this.inReactClass).rank;
            if (rank !== -1 && rank < targetRank) {
                max = Math.max(max, rank);
            }
        }
        return max;
    };
    MemberOrderingWalker.prototype.isReactClass = function (node) {
        if (!node.heritageClauses || node.heritageClauses.length !== 1) {
            return false;
        }
        var clause = node.heritageClauses[0];
        if (clause.types == null) {
            return false;
        }
        var ancestor = clause.types[0];
        if (!ancestor) {
            return false;
        }
        return /^(RelayComponent|Component|PureComponent|React.Component|React.PureComponent)($|<)/.test(ancestor.getText(this.getSourceFile()));
    };
    MemberOrderingWalker.prototype.lifecycleMethodToOrder = function (lifecycleMethodName) {
        var idx = this.opts.lifecycleOrderings.indexOf(lifecycleMethodName);
        if (idx < 0) {
            throw new Error('Lifecycle method ' + lifecycleMethodName + ' not found');
        }
        return idx;
    };
    MemberOrderingWalker.prototype.lifecycleOrderLess = function (lhs, rhs) {
        var lhsOrder = this.lifecycleMethodToOrder(lhs);
        var rhsOrder = this.lifecycleMethodToOrder(rhs);
        if (lhsOrder < rhsOrder) {
            return true;
        }
        return false;
    };
    MemberOrderingWalker.prototype.memberRank = function (member, inReactClass) {
        var optionName = getMemberKind(member, inReactClass);
        if (optionName === undefined) {
            return {
                isLifecycleMethod: false,
                rank: -1,
            };
        }
        return {
            isLifecycleMethod: optionName === MemberKind.reactLifecycleMethod,
            rank: this.opts.order.findIndex(function (category) { return category.has(optionName); }),
        };
    };
    MemberOrderingWalker.prototype.rankName = function (rank) {
        return this.opts.order[rank].name;
    };
    MemberOrderingWalker.prototype.sortMembers = function (members, inReactClass) {
        var _this = this;
        // This shoves all unranked members to the bottom.
        // It might not be ideal but we are not using that kind of stuff.
        var cmp = function (a, b) {
            var aRank = _this.memberRank(a, inReactClass);
            var bRank = _this.memberRank(b, inReactClass);
            if (aRank.rank < bRank.rank) {
                return -1;
            }
            else if (bRank.rank < aRank.rank) {
                return 1;
            }
            // Pray to god this is stable sort
            if (!_this.opts.alphabetize || a.name == null || b.name == null) {
                return 0;
            }
            var aName = nameString(a.name);
            var bName = nameString(b.name);
            if (aRank.isLifecycleMethod) {
                if (_this.lifecycleOrderLess(aName, bName)) {
                    return -1;
                }
                return 1;
            }
            if (caseInsensitiveLess(aName, bName)) {
                return -1;
            }
            return 1;
        };
        var sortedMembers = members.slice(0).sort(cmp);
        return sortedMembers.map(function (v) { return v.getFullText(); }).join('');
    };
    MemberOrderingWalker.prototype.visitMembers = function (members) {
        var _this = this;
        var prevRank = -1;
        var prevName;
        var generateFix = function () {
            var sortedMembers = _this.sortMembers(members, _this.inReactClass);
            var start = members.pos;
            var width = members.end - start;
            return new Lint.Replacement(start, width, sortedMembers);
        };
        for (var _i = 0, members_4 = members; _i < members_4.length; _i++) {
            var member = members_4[_i];
            var _a = this.memberRank(member, this.inReactClass), rank = _a.rank, isLifecycleMethod = _a.isLifecycleMethod;
            if (rank === -1) {
                // no explicit ordering for this kind of node specified, so continue
                continue;
            }
            if (rank < prevRank) {
                var nodeType = this.rankName(rank);
                var prevNodeType = this.rankName(prevRank);
                var lowerRank = this.findLowerRank(members, rank);
                var locationHint = lowerRank !== -1 ? "after " + this.rankName(lowerRank) + "s" : 'at the beginning of the class/interface';
                var errorLine1 = "Declaration of " + nodeType + " not allowed after declaration of " + prevNodeType + ". " +
                    ("Instead, this should come " + locationHint + ".");
                this.addFailureAtNode(member, errorLine1, generateFix());
            }
            else {
                if (this.opts.alphabetize && member.name) {
                    if (rank !== prevRank) {
                        // No alphabetical ordering between different ranks
                        prevName = undefined;
                    }
                    var curName = nameString(member.name);
                    if (isLifecycleMethod) {
                        if (prevName === undefined) {
                            prevName = curName;
                        }
                        else {
                            if (this.lifecycleOrderLess(curName, prevName)) {
                                this.addFailureAtNode(member.name, Rule.FAILURE_STRING_REACT_LIFE_CYCLE_METHOD_ORDER(this.findLowerLicecycleName(members, rank, curName), curName), generateFix());
                            }
                            else {
                                prevName = curName;
                            }
                        }
                    }
                    else {
                        if (prevName !== undefined && caseInsensitiveLess(curName, prevName)) {
                            this.addFailureAtNode(member.name, Rule.FAILURE_STRING_ALPHABETIZE(this.findLowerName(members, rank, curName), curName), generateFix());
                        }
                        else {
                            prevName = curName;
                        }
                    }
                }
                // keep track of last good node
                prevRank = rank;
            }
        }
    };
    MemberOrderingWalker.prototype.visitClassDeclaration = function (node) {
        var originalInReactClass = this.inReactClass;
        this.inReactClass = this.isReactClass(node);
        this.visitMembers(node.members);
        _super.prototype.visitClassDeclaration.call(this, node);
        this.inReactClass = originalInReactClass;
    };
    MemberOrderingWalker.prototype.visitClassExpression = function (node) {
        var originalInReactClass = this.inReactClass;
        this.inReactClass = this.isReactClass(node);
        this.visitMembers(node.members);
        _super.prototype.visitClassExpression.call(this, node);
        this.inReactClass = originalInReactClass;
    };
    MemberOrderingWalker.prototype.visitInterfaceDeclaration = function (node) {
        var originalInReactClass = this.inReactClass;
        this.inReactClass = false;
        this.visitMembers(node.members);
        _super.prototype.visitInterfaceDeclaration.call(this, node);
        this.inReactClass = originalInReactClass;
    };
    MemberOrderingWalker.prototype.visitObjectLiteralExpression = function (node) {
        var originalInReactClass = this.inReactClass;
        this.inReactClass = false;
        _super.prototype.visitObjectLiteralExpression.call(this, node);
        this.inReactClass = originalInReactClass;
    };
    MemberOrderingWalker.prototype.visitTypeLiteral = function (node) {
        var originalInReactClass = this.inReactClass;
        this.inReactClass = false;
        this.visitMembers(node.members);
        this.inReactClass = originalInReactClass;
        _super.prototype.visitTypeLiteral.call(this, node);
    };
    return MemberOrderingWalker;
}(Lint.RuleWalker));
exports.MemberOrderingWalker = MemberOrderingWalker;
function caseInsensitiveLess(a, b) {
    return a.toLowerCase() < b.toLowerCase();
}
function memberKindForConstructor(access) {
    return MemberKind[access + 'Constructor'];
}
function memberKindForMethodOrField(access, membership, kind) {
    return MemberKind[access + membership + kind];
}
var allAccess = ['public', 'protected', 'private'];
function memberKindFromName(name) {
    var kind = MemberKind[Lint.Utils.camelize(name)];
    return typeof kind === 'number' ? [kind] : allAccess.map(addModifier);
    function addModifier(modifier) {
        var modifiedKind = MemberKind[Lint.Utils.camelize(modifier + '-' + name)];
        if (typeof modifiedKind !== 'number') {
            throw new Error("Bad member kind: " + name);
        }
        return modifiedKind;
    }
}
var reactLifecycleMethods = [
    'componentWillMount',
    'componentDidMount',
    'componentWillReceiveProps',
    'shouldComponentUpdate',
    'componentWillUpdate',
    'componentDidUpdate',
    'componentWillUnmount',
];
function getMemberKind(member, inReactClass) {
    if (inReactClass) {
        if (member.kind === ts.SyntaxKind.MethodDeclaration || member.kind === ts.SyntaxKind.MethodSignature) {
            var memberName = nameString(member.name);
            if (memberName === 'render') {
                return MemberKind.reactRenderMethod;
            }
            if (reactLifecycleMethods.indexOf(memberName) >= 0) {
                return MemberKind.reactLifecycleMethod;
            }
        }
    }
    var accessLevel = hasModifier(ts.SyntaxKind.PrivateKeyword)
        ? 'private'
        : hasModifier(ts.SyntaxKind.ProtectedKeyword)
            ? 'protected'
            : 'public';
    switch (member.kind) {
        case ts.SyntaxKind.Constructor:
        case ts.SyntaxKind.ConstructSignature:
            return memberKindForConstructor(accessLevel);
        case ts.SyntaxKind.PropertyDeclaration:
        case ts.SyntaxKind.PropertySignature:
            return methodOrField(isFunctionLiteral(member.initializer));
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.MethodSignature:
            return methodOrField(true);
        default:
            return undefined;
    }
    function methodOrField(isMethod) {
        var membership = hasModifier(ts.SyntaxKind.StaticKeyword) ? 'Static' : 'Instance';
        return memberKindForMethodOrField(accessLevel, membership, isMethod ? 'Method' : 'Field');
    }
    function hasModifier(kind) {
        return Lint.hasModifier(member.modifiers, kind);
    }
}
var MemberCategory = /** @class */ (function () {
    function MemberCategory(name, kinds) {
        this.name = name;
        this.kinds = kinds;
    }
    MemberCategory.prototype.has = function (kind) {
        return this.kinds.has(kind);
    };
    return MemberCategory;
}());
function parseOptions(options) {
    var _a = getOptionsJson(options), orderJson = _a.order, alphabetize = _a.alphabetize, lifecycleOrderings = _a.lifecycleOrderings;
    var order = orderJson.map(function (cat) {
        return typeof cat === 'string'
            ? new MemberCategory(cat.replace(/-/g, ' '), new Set(memberKindFromName(cat)))
            : new MemberCategory(cat.name, new Set(utils_1.flatMap(cat.kinds, memberKindFromName)));
    });
    return { order: order, alphabetize: alphabetize, lifecycleOrderings: lifecycleOrderings };
}
function getOptionsJson(allOptions) {
    if (allOptions == null || allOptions.length === 0 || allOptions[0] == null) {
        throw new Error('Got empty options');
    }
    var firstOption = allOptions[0];
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
function categoryFromOption(orderOption) {
    if (Array.isArray(orderOption)) {
        return orderOption;
    }
    var preset = PRESETS.get(orderOption);
    if (!preset) {
        throw new Error("Bad order: " + JSON.stringify(orderOption));
    }
    return preset;
}
function lifecycleOrderingsFromOption(opts) {
    if (opts == null) {
        return reactLifecycleMethods.slice(0);
    }
    if (!Array.isArray(opts)) {
        throw new Error(OPTION_LIFECYCLEORDERINGS + " must be an array consisting of values " + reactLifecycleMethods.join(', '));
    }
    if (opts.find(function (v) { return typeof v !== 'string'; })) {
        throw new Error(OPTION_LIFECYCLEORDERINGS + " must be an array consisting of values " + reactLifecycleMethods.join(', '));
    }
    var options = new Set(opts);
    if (options.size !== opts.length) {
        throw new Error(OPTION_LIFECYCLEORDERINGS + " must have unique values");
    }
    if (opts.length !== reactLifecycleMethods.length) {
        throw new Error(OPTION_LIFECYCLEORDERINGS + " must be an array consisting of values " + reactLifecycleMethods.join(', '));
    }
    return opts;
}
/**
 * Convert from undocumented old-style options.
 * This is designed to mimic the old behavior and should be removed eventually.
 */
function convertFromOldStyleOptions(options) {
    var categories = [{ name: 'member', kinds: allMemberKindNames }];
    if (hasOption('variables-before-functions')) {
        categories = splitOldStyleOptions(categories, function (kind) { return kind.includes('field'); }, 'field', 'method');
    }
    if (hasOption('static-before-instance')) {
        categories = splitOldStyleOptions(categories, function (kind) { return kind.includes('static'); }, 'static', 'instance');
    }
    if (hasOption('public-before-private')) {
        // 'protected' is considered public
        categories = splitOldStyleOptions(categories, function (kind) { return !kind.includes('private'); }, 'public', 'private');
    }
    return categories;
    function hasOption(x) {
        return options.indexOf(x) !== -1;
    }
}
function splitOldStyleOptions(categories, filter, a, b) {
    var newCategories = [];
    var _loop_1 = function (cat) {
        var yes = [];
        var no = [];
        for (var _i = 0, _a = cat.kinds; _i < _a.length; _i++) {
            var kind = _a[_i];
            if (filter(kind)) {
                yes.push(kind);
            }
            else {
                no.push(kind);
            }
        }
        var augmentName = function (s) {
            if (a === 'field') {
                // Replace "member" with "field"/"method" instead of augmenting.
                return s;
            }
            return s + " " + cat.name;
        };
        newCategories.push({ name: augmentName(a), kinds: yes });
        newCategories.push({ name: augmentName(b), kinds: no });
    };
    for (var _i = 0, categories_1 = categories; _i < categories_1.length; _i++) {
        var cat = categories_1[_i];
        _loop_1(cat);
    }
    return newCategories;
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
function nameString(name) {
    switch (name.kind) {
        case ts.SyntaxKind.Identifier:
        case ts.SyntaxKind.StringLiteral:
        case ts.SyntaxKind.NumericLiteral:
            return name.text;
        default:
            return '';
    }
}
var templateObject_1, templateObject_2, templateObject_3;
