"use strict";
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
var typescript_scope_analysis_1 = require("@secoya/typescript-scope-analysis");
var Lint = require("tslint");
var ts = require("typescript");
var Rule = /** @class */ (function (_super) {
    __extends(Rule, _super);
    function Rule() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    Rule.prototype.apply = function (sourceFile) {
        return this.applyWithWalker(new ReactHooksExhaustiveDeps(sourceFile, this.getOptions()));
    };
    Rule.metadata = {
        description: 'Errors on non exhaustive dependencies used for react hooks. ',
        optionExamples: [],
        options: {
            additionalProperties: false,
            properties: {
                additionalHooks: {
                    type: 'string',
                },
            },
            type: 'object',
        },
        optionsDescription: '',
        rationale: 'To avoid improper use of React Hooks.',
        requiresTypeInfo: false,
        ruleName: 'react-hooks-exhaustive-deps',
        type: 'typescript',
        typescriptOnly: false,
    };
    return Rule;
}(Lint.Rules.AbstractRule));
exports.Rule = Rule;
function parseOptions(options) {
    if (options.length === 0) {
        return {};
    }
    if (options.length > 1) {
        throw new Error('Got more than a single options object');
    }
    if (options[0].additionalHooks != null && options[0].additionalHooks.length > 0) {
        return { additionalHooks: new RegExp(options[0].additionalHooks) };
    }
    return {};
}
var ReactHooksExhaustiveDeps = /** @class */ (function (_super) {
    __extends(ReactHooksExhaustiveDeps, _super);
    function ReactHooksExhaustiveDeps(sourceFile, options) {
        var _this = _super.call(this, sourceFile, options) || this;
        _this.ruleOptions = parseOptions(_this.getOptions());
        _this.scopesContainer = null;
        _this.staticKnownValueCache = new WeakMap();
        _this.functionWithoutCapturedValueCache = new WeakMap();
        _this.setStateCallSites = new WeakMap();
        _this.stateVariables = new WeakSet();
        return _this;
    }
    ReactHooksExhaustiveDeps.prototype.getScope = function (node) {
        return this.getScopesContainer().getScopeForNode(node);
    };
    ReactHooksExhaustiveDeps.prototype.getScopesContainer = function () {
        if (this.scopesContainer == null) {
            this.scopesContainer = new typescript_scope_analysis_1.SourceFileScopesContainer(this.getSourceFile());
        }
        return this.scopesContainer;
    };
    ReactHooksExhaustiveDeps.prototype.visitFunctionLikeExpression = function (funcExpr) {
        var _this = this;
        // tslint:disable:no-console
        // Only visit function expressions when the parent node is a call expression (ie. it is a parameter to a hook)
        if (!ts.isCallExpression(funcExpr.parent)) {
            return;
        }
        var callee = funcExpr.parent.expression;
        if (!ts.isIdentifier(callee) && !ts.isPropertyAccessExpression(callee)) {
            return;
        }
        var callbackIndex = getReactiveHookCallbackIndex(callee, this.ruleOptions);
        // If this function expression is not where the callback is, skip it
        if (funcExpr.parent.arguments[callbackIndex] !== funcExpr) {
            return;
        }
        // Get the reactive hook node.
        var reactiveHook = funcExpr.parent.expression;
        var reactiveHookNameNode = getNodeWithoutReactNamespace(reactiveHook, this.ruleOptions);
        if (reactiveHookNameNode == null || !ts.isIdentifier(reactiveHookNameNode)) {
            return;
        }
        var reactiveHookName = reactiveHookNameNode.text;
        var isEffect = reactiveHookName.endsWith('Effect');
        // Get the declared dependencies for this reactive hook. If there is no
        // second argument then the reactive callback will re-run on every render.
        // So no need to check for dependency inclusion.
        var depsIndex = callbackIndex + 1;
        var declaredDependenciesNode = unwrapNonSemanticExpressions(funcExpr.parent.arguments[depsIndex]);
        if (!declaredDependenciesNode && !isEffect) {
            // These are only used for optimization.
            if (reactiveHookName === 'useMemo' || reactiveHookName === 'useCallback') {
                // TODO: Can this have an autofix?
                this.addFailureAtNode(funcExpr.parent.expression, "React Hook " + reactiveHookName + " does nothing when called with " +
                    "only one argument. Did you forget to pass an array of " +
                    "dependencies?");
            }
            return;
        }
        if (isEffect && isAsync(funcExpr)) {
            this.addFailureAtNode(funcExpr, "Effect callbacks are synchronous to prevent race conditions. " +
                'Learn more about data fetching with Hooks: https://fb.me/react-hooks-data-fetching');
        }
        // Get the current scope
        var scope = this.getScope(funcExpr.body);
        // Find all our "pure scopes". On every re-render of a component these
        // pure scopes may have changes to the variables declared within. So all
        // variables used in our reactive hook callback but declared in a pure
        // scope need to be listed as dependencies of our reactive hook callback.
        //
        // According to the rules of React you can't read a mutable value in pure
        // scope. We can't enforce this in a lint so we trust that all variables
        // declared outside of pure scope are indeed frozen.
        var pureScopes = new Set();
        var componentScope = null;
        {
            var currentScope = scope.getParentScope();
            while (currentScope) {
                pureScopes.add(currentScope);
                if (currentScope.scopeKind === typescript_scope_analysis_1.ScopeKind.FunctionScope) {
                    break;
                }
                currentScope = currentScope.getParentScope();
            }
            // If there is no parent function scope then there are no pure scopes.
            // The ones we've collected so far are incorrect. So don't continue with
            // the lint.
            if (!currentScope) {
                return;
            }
            componentScope = currentScope;
        }
        var nonNullableComponentScope = componentScope;
        var parentScopes = getParentScopes(nonNullableComponentScope);
        // Next we'll define a few helpers that helps us
        // tell if some values don't have to be declared as deps.
        // Some are known to be static based on Hook calls.
        // const [state, setState] = useState() / React.useState()
        //               ^^^ true for this reference
        // const [state, dispatch] = useReducer() / React.useReducer()
        //               ^^^ true for this reference
        // const ref = useRef()
        //       ^^^ true for this reference
        // False for everything else.
        var isStaticKnownHookValue = function (binding) {
            var def = binding.declaringNode;
            // Look for `let stuff = ...`
            if (!ts.isVariableDeclaration(def)) {
                return false;
            }
            var init = def.initializer;
            if (init == null) {
                return false;
            }
            // Detect primitive constants
            // const foo = 42
            var declaration = def.parent;
            if (!ts.isVariableDeclarationList(declaration)) {
                return false;
            }
            if (isConstVariableDeclaration(declaration) &&
                (ts.isStringLiteral(init) || ts.isNumericLiteral(init) || init.kind === ts.SyntaxKind.NullKeyword)) {
                // Definitely static
                return true;
            }
            // Detect known Hook calls
            // const [_, setState] = useState()
            if (!ts.isCallExpression(init)) {
                return false;
            }
            var expr = init.expression;
            // Step into `= React.something` initializer.
            if (ts.isPropertyAccessExpression(expr) &&
                ts.isIdentifier(expr.expression) &&
                expr.expression.text === 'React') {
                expr = expr.name;
            }
            if (!ts.isIdentifier(expr)) {
                return false;
            }
            var id = def.name;
            var name = expr.text;
            if (name === 'useRef' && ts.isIdentifier(id)) {
                // useRef() return value is static.
                return true;
            }
            else if (name === 'useState' || name === 'useReducer') {
                // Only consider second value in initializing tuple static.
                if (ts.isArrayBindingPattern(id) && id.elements.length === 2) {
                    var firstBinding = id.elements[0];
                    var secondBinding = id.elements[1];
                    // Is second tuple value the same reference we're checking?
                    if (ts.isBindingElement(secondBinding) &&
                        ts.isIdentifier(secondBinding.name) &&
                        secondBinding.name.text === binding.identifier) {
                        if (name === 'useState') {
                            var references = binding.references;
                            for (var _i = 0, references_2 = references; _i < references_2.length; _i++) {
                                var reference = references_2[_i];
                                _this.setStateCallSites.set(reference.identifier, firstBinding);
                            }
                        }
                        // Setter is static.
                        return true;
                    }
                    else if (ts.isBindingElement(firstBinding) &&
                        ts.isIdentifier(firstBinding.name) &&
                        firstBinding.name.text === binding.identifier) {
                        if (name === 'useState') {
                            var references = binding.references;
                            for (var _a = 0, references_3 = references; _a < references_3.length; _a++) {
                                var reference = references_3[_a];
                                _this.stateVariables.add(reference.identifier);
                            }
                        }
                        // State variable itself is dynamic.
                        return false;
                    }
                }
            }
            // By default assume it's dynamic.
            return false;
        };
        // Some are just functions that don't reference anything dynamic.
        function isFunctionWithoutCapturedValues(binding) {
            // Search the direct component subscopes for
            // top-level function definitions matching this reference.
            var fnNode = binding.declaringNode;
            var childScopes = nonNullableComponentScope.getChildScopes();
            var fnScope = null;
            for (var _i = 0, childScopes_1 = childScopes; _i < childScopes_1.length; _i++) {
                var childScope = childScopes_1[_i];
                var childScopeBlock = childScope.getDeclaringNode();
                if (
                // function handleChange() {}
                ((ts.isFunctionDeclaration(fnNode) || ts.isFunctionExpression(fnNode)) &&
                    childScopeBlock === fnNode) ||
                    // const handleChange = function() {}
                    // const handleChange = () => {}
                    (ts.isVariableDeclaration(fnNode) && childScopeBlock === fnNode.initializer)) {
                    // // Found it!
                    fnScope = childScope;
                    break;
                }
            }
            if (fnScope == null) {
                return false;
            }
            // Does this function capture any values
            // that are in pure scopes (aka render)?
            var fnParentScopes = getParentScopes(fnScope);
            for (var _a = 0, _b = fnScope
                .getAllReferencesRecursively()
                .filter(function (x) { return x.referenceTo != null && fnParentScopes.has(x.referenceTo.scope); }); _a < _b.length; _a++) {
                var reference = _b[_a];
                if (
                // Filter ensures referenceTo is not null
                pureScopes.has(reference.referenceTo.scope) &&
                    // Static values are fine though,
                    // although we won't check functions deeper.
                    !memoizedIsStaticKnownHookValue(reference.referenceTo.binding)) {
                    return false;
                }
            }
            // If we got here, this function doesn't capture anything
            // from render--or everything it captures is known static.
            return true;
        }
        // Remember such values. Avoid re-running extra checks on them.
        var memoizedIsStaticKnownHookValue = memoizeWithWeakMap(isStaticKnownHookValue, this.staticKnownValueCache);
        var memoizedIsFunctionWithoutCapturedValues = memoizeWithWeakMap(isFunctionWithoutCapturedValues, this.functionWithoutCapturedValueCache);
        // These are usually mistaken. Collect them.
        var currentRefsInEffectCleanup = new Map();
        // Is this reference inside a cleanup function for this effect node?
        // We can check by traversing scopes upwards  from the reference, and checking
        // if the last "return () => " we encounter is located directly inside the effect.
        function isInsideEffectCleanup(reference) {
            var curScope = reference.referencedFromScope;
            var isInReturnedFunction = false;
            while (curScope != null && curScope.getDeclaringNode() !== funcExpr) {
                var declaringNode = curScope.getDeclaringNode();
                if (ts.isArrowFunction(declaringNode) || ts.isFunctionExpression(declaringNode)) {
                    isInReturnedFunction = declaringNode.parent != null && ts.isReturnStatement(declaringNode.parent);
                }
                curScope = curScope.getParentScope();
            }
            return isInReturnedFunction;
        }
        // Get dependencies from all our resolved references in pure scopes.
        // Key is dependency string, value is whether it's static.
        var dependencies = new Map();
        gatherDependenciesRecursively(scope);
        function gatherDependenciesRecursively(currentScope) {
            for (var _i = 0, _a = currentScope.getReferences(); _i < _a.length; _i++) {
                var reference = _a[_i];
                // If we can't resolve the reference we don't care
                if (reference.referenceTo == null) {
                    continue;
                }
                // If it is not declared in a pure scope we don't care
                if (!pureScopes.has(reference.referenceTo.scope)) {
                    continue;
                }
                var referenceNode = fastFindReferenceWithParent(funcExpr, reference.identifier);
                if (referenceNode == null) {
                    continue;
                }
                var dependencyNode = getDependency(referenceNode);
                var dependency = toPropertyAccessString(dependencyNode);
                // Accessing ref.current inside effect cleanup is bad.
                if (
                // We're in an effect...
                isEffect &&
                    // ... and this look like accessing .current...
                    ts.isIdentifier(dependencyNode) &&
                    ts.isPropertyAccessExpression(dependencyNode.parent) &&
                    dependencyNode.parent.name.text === 'current' &&
                    isInsideEffectCleanup(reference)) {
                    currentRefsInEffectCleanup.set(dependency, {
                        dependencyNode: dependencyNode,
                        dependencyNodePropertyAccess: dependencyNode.parent,
                        reference: reference,
                    });
                }
                var declaringBinding = reference.referenceTo.binding;
                var declaringNode = declaringBinding.declaringNode;
                // Ignore references to the function itself as it's not defined yet.
                if (getDeclaringExpr(declaringNode) === funcExpr.parent) {
                    continue;
                }
                var existingDependency = dependencies.get(dependency);
                if (existingDependency == null) {
                    var isStatic = memoizedIsStaticKnownHookValue(declaringBinding) ||
                        memoizedIsFunctionWithoutCapturedValues(declaringBinding);
                    dependencies.set(dependency, {
                        isStatic: isStatic,
                        references: [reference],
                    });
                }
                else {
                    existingDependency.references.push(reference);
                }
            }
            for (var _b = 0, _c = currentScope.getChildScopes(); _b < _c.length; _b++) {
                var childScope = _c[_b];
                gatherDependenciesRecursively(childScope);
            }
        }
        // Warn about accessing .current in cleanup effects.
        currentRefsInEffectCleanup.forEach(function (_a, dependency) {
            var reference = _a.reference, dependencyNode = _a.dependencyNode, dependencyNodePropertyAccess = _a.dependencyNodePropertyAccess;
            var references = reference.referenceTo.binding.references;
            // Is React managing this ref or us?
            // Let's see if we can find a .current assignment.
            var foundCurrentAssignment = false;
            for (var _i = 0, references_4 = references; _i < references_4.length; _i++) {
                var refReference = references_4[_i];
                var identifier = refReference.identifier;
                var parent = identifier.parent;
                if (parent != null &&
                    // ref.current
                    ts.isPropertyAccessExpression(parent) &&
                    parent.name.text === 'current' &&
                    parent.expression === identifier &&
                    // ref.current = <something>
                    ts.isBinaryExpression(parent.parent) &&
                    parent.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                    parent.parent.left === parent) {
                    foundCurrentAssignment = true;
                    break;
                }
            }
            // We only want to warn about React-managed refs.
            if (foundCurrentAssignment) {
                return;
            }
            _this.addFailureAtNode(dependencyNodePropertyAccess.name, "The ref value '" + dependency + ".current' will likely have " +
                "changed by the time this effect cleanup function runs. If " +
                "this ref points to a node rendered by React, copy " +
                ("'" + dependency + ".current' to a variable inside the effect, and ") +
                "use that variable in the cleanup function.");
        });
        // Warn about assigning to variables in the outer scope.
        // Those are usually bugs.
        var staleAssignments = new Set();
        var reportStaleAssignment = function (writeExpr, key) {
            if (staleAssignments.has(key)) {
                return;
            }
            staleAssignments.add(key);
            _this.addFailureAtNode(writeExpr, "Assignments to the '" + key + "' variable from inside React Hook " +
                (reactiveHook.getText() + " will be lost after each ") +
                "render. To preserve the value over time, store it in a useRef " +
                "Hook and keep the mutable value in the '.current' property. " +
                "Otherwise, you can move this variable directly inside " +
                (reactiveHook.getText() + "."));
        };
        // Remember which deps are optional and report bad usage first.
        var optionalDependencies = new Set();
        dependencies.forEach(function (_a, key) {
            var isStatic = _a.isStatic, references = _a.references;
            if (isStatic) {
                optionalDependencies.add(key);
            }
            references.forEach(function (reference) {
                if (reference.writeExpr) {
                    reportStaleAssignment(reference.writeExpr, key);
                }
            });
        });
        if (staleAssignments.size > 0) {
            // The intent isn't clear so we'll wait until you fix those first.
            return;
        }
        if (!declaredDependenciesNode) {
            // Check if there are any top-level setState() calls.
            // Those tend to lead to infinite loops.
            var setStateInsideEffectWithoutDeps_1 = null;
            dependencies.forEach(function (_a, key) {
                var isStatic = _a.isStatic, references = _a.references;
                if (setStateInsideEffectWithoutDeps_1) {
                    return;
                }
                references.forEach(function (reference) {
                    if (setStateInsideEffectWithoutDeps_1) {
                        return;
                    }
                    var id = reference.identifier;
                    var isSetState = _this.setStateCallSites.has(id);
                    if (!isSetState) {
                        return;
                    }
                    var fnScope = reference.referencedFromScope;
                    while (fnScope != null &&
                        fnScope.scopeKind !== typescript_scope_analysis_1.ScopeKind.FunctionScope &&
                        (!ts.isFunctionDeclaration(fnScope.getDeclaringNode()) ||
                            !ts.isArrowFunction(fnScope.getDeclaringNode()))) {
                        fnScope = fnScope.getParentScope();
                    }
                    if (fnScope == null) {
                        return;
                    }
                    var isDirectlyInsideEffect = fnScope.getDeclaringNode() === funcExpr;
                    if (isDirectlyInsideEffect) {
                        // TODO: we could potentially ignore early returns.
                        setStateInsideEffectWithoutDeps_1 = key;
                    }
                });
            });
            if (setStateInsideEffectWithoutDeps_1) {
                // tslint:disable-next-line:no-shadowed-variable
                var suggestedDependencies_1 = collectRecommendations({
                    declaredDependencies: [],
                    dependencies: dependencies,
                    externalDependencies: new Set(),
                    isEffect: true,
                    optionalDependencies: optionalDependencies,
                }).suggestedDependencies;
                this.addFailureAtNode(callee, "React Hook " + reactiveHookName + " contains a call to '" + setStateInsideEffectWithoutDeps_1 + "'. " +
                    "Without a list of dependencies, this can lead to an infinite chain of updates. " +
                    "To fix this, pass [" +
                    suggestedDependencies_1.join(', ') +
                    ("] as a second argument to the " + reactiveHookName + " Hook."));
            }
            return;
        }
        var declaredDependencies = [];
        var externalDependencies = new Set();
        if (!ts.isArrayLiteralExpression(declaredDependenciesNode)) {
            // If the declared dependencies are not an array expression then we
            // can't verify that the user provided the correct dependencies. Tell
            // the user this in an error.
            this.addFailureAtNode(declaredDependenciesNode, "React Hook " + reactiveHook.getText() + " was passed a " +
                'dependency list that is not an array literal. This means we ' +
                "can't statically verify whether you've passed the correct " +
                'dependencies.');
        }
        else {
            declaredDependenciesNode.elements.forEach(function (declaredDependencyNodeRaw) {
                var declaredDependencyNode = unwrapNonSemanticExpressions(declaredDependencyNodeRaw);
                // Skip elided elements.
                if (ts.isOmittedExpression(declaredDependencyNode)) {
                    return;
                }
                // If we see a spread element then add a special warning.
                if (ts.isSpreadElement(declaredDependencyNode)) {
                    _this.addFailureAtNode(declaredDependencyNode, "React Hook " + reactiveHook.getText() + " has a spread " +
                        "element in its dependency array. This means we can't " +
                        "statically verify whether you've passed the " +
                        'correct dependencies.');
                    return;
                }
                // Try to normalize the declared dependency. If we can't then an error
                // will be thrown. We will catch that error and report an error.
                var declaredDependency;
                try {
                    declaredDependency = toPropertyAccessString(declaredDependencyNode);
                }
                catch (error) {
                    if (/Unsupported node type/.test(error.message)) {
                        if (ts.isStringLiteral(declaredDependencyNode) ||
                            ts.isNumericLiteral(declaredDependencyNode) ||
                            declaredDependencyNode.kind === ts.SyntaxKind.FalseKeyword ||
                            declaredDependencyNode.kind === ts.SyntaxKind.TrueKeyword ||
                            declaredDependencyNode.kind === ts.SyntaxKind.NullKeyword ||
                            declaredDependencyNode.kind === ts.SyntaxKind.UndefinedKeyword) {
                            if (ts.isStringLiteral(declaredDependencyNode) &&
                                dependencies.has(declaredDependencyNode.text)) {
                                _this.addFailureAtNode(declaredDependencyNode, "The '" + declaredDependencyNode.text + "' literal is not a valid dependency " +
                                    "because it never changes. " +
                                    ("Did you mean to include " + declaredDependencyNode.text + " in the array instead?"));
                            }
                            else {
                                _this.addFailureAtNode(declaredDependencyNode, "The " + declaredDependencyNode.getText() + " literal is not a valid dependency " +
                                    'because it never changes. You can safely remove it.');
                            }
                        }
                        else {
                            _this.addFailureAtNode(declaredDependencyNode, "React Hook " + reactiveHook.getText() + " has a " +
                                "complex expression in the dependency array. " +
                                'Extract it to a separate variable so it can be statically checked.');
                        }
                        return;
                    }
                    else {
                        throw error;
                    }
                }
                var maybeID = declaredDependencyNode;
                while (ts.isPropertyAccessExpression(maybeID) || ts.isElementAccessExpression(maybeID)) {
                    maybeID = maybeID.expression;
                }
                var isDeclaredInComponent = !nonNullableComponentScope
                    .getAllReferencesRecursively()
                    .some(function (ref) {
                    return ref.identifier === maybeID &&
                        (ref.referenceTo == null || parentScopes.has(ref.referenceTo.scope));
                });
                // Add the dependency to our declared dependency map.
                declaredDependencies.push({
                    key: declaredDependency,
                    node: declaredDependencyNode,
                });
                if (!isDeclaredInComponent) {
                    externalDependencies.add(declaredDependency);
                }
            });
        }
        // tslint:disable:no-console
        // console.log('decl: ', declaredDependencies);
        // console.log('dependencies: ', dependencies);
        // console.log('externalDependencies: ', externalDependencies);
        // console.log('isEffect: ', isEffect);
        // console.log('optionalDependencies: ', optionalDependencies);
        var recommendations = collectRecommendations({
            declaredDependencies: declaredDependencies,
            dependencies: dependencies,
            externalDependencies: externalDependencies,
            isEffect: isEffect,
            optionalDependencies: optionalDependencies,
        });
        var duplicateDependencies = recommendations.duplicateDependencies, missingDependencies = recommendations.missingDependencies, unnecessaryDependencies = recommendations.unnecessaryDependencies;
        var suggestedDependencies = recommendations.suggestedDependencies;
        var problemCount = duplicateDependencies.size + missingDependencies.size + unnecessaryDependencies.size;
        if (problemCount === 0) {
            // If nothing else to report, check if some callbacks
            // are bare and would invalidate on every render.
            var bareFunctions = scanForDeclaredBareFunctions({
                componentScope: componentScope,
                declaredDependencies: declaredDependencies,
                declaredDependenciesNode: declaredDependenciesNode,
                scope: scope,
            });
            bareFunctions.forEach(function (_a) {
                var fn = _a.fn, suggestUseCallback = _a.suggestUseCallback;
                var line = ts.getLineAndCharacterOfPosition(declaredDependenciesNode.getSourceFile(), declaredDependenciesNode.getStart()).line;
                var message = "The '" + fn.identifier + "' function makes the dependencies of " +
                    (reactiveHookName + " Hook (at line " + line + ") ") +
                    "change on every render.";
                if (suggestUseCallback) {
                    message +=
                        " To fix this, " + ("wrap the '" + fn.identifier + "' definition into its own useCallback() Hook.");
                }
                else {
                    message +=
                        " Move it inside the " + reactiveHookName + " callback. " +
                            ("Alternatively, wrap the '" + fn.identifier + "' definition into its own useCallback() Hook.");
                }
                // TODO: What if the function needs to change on every render anyway?
                // Should we suggest removing effect deps as an appropriate fix too?
                _this.addFailureAtNode(fn.declaringNode, message);
            });
            return;
        }
        // If we're going to report a missing dependency,
        // we might as well recalculate the list ignoring
        // the currently specified deps. This can result
        // in some extra deduplication. We can't do this
        // for effects though because those have legit
        // use cases for over-specifying deps.
        if (!isEffect && missingDependencies.size > 0) {
            suggestedDependencies = collectRecommendations({
                declaredDependencies: [],
                dependencies: dependencies,
                externalDependencies: externalDependencies,
                isEffect: isEffect,
                optionalDependencies: optionalDependencies,
            }).suggestedDependencies;
        }
        // Alphabetize the suggestions, but only if deps were already alphabetized.
        function areDeclaredDepsAlphabetized() {
            if (declaredDependencies.length === 0) {
                return true;
            }
            var declaredDepKeys = declaredDependencies.map(function (dep) { return dep.key; });
            var sortedDeclaredDepKeys = declaredDepKeys.slice().sort();
            return declaredDepKeys.join(',') === sortedDeclaredDepKeys.join(',');
        }
        if (areDeclaredDepsAlphabetized()) {
            suggestedDependencies.sort();
        }
        function getWarningMessage(deps, singlePrefix, label, fixVerb) {
            if (deps.size === 0) {
                return null;
            }
            return ((deps.size > 1 ? '' : singlePrefix + ' ') +
                label +
                ' ' +
                (deps.size > 1 ? 'dependencies' : 'dependency') +
                ': ' +
                joinEnglish(Array.from(deps)
                    .sort()
                    .map(function (name) { return "'" + name + "'"; })) +
                (". Either " + fixVerb + " " + (deps.size > 1 ? 'them' : 'it') + " or remove the dependency array."));
        }
        var extraWarning = '';
        if (unnecessaryDependencies.size > 0) {
            var badRef_1 = null;
            Array.from(unnecessaryDependencies.keys()).forEach(function (key) {
                if (badRef_1 !== null) {
                    return;
                }
                if (key.endsWith('.current')) {
                    badRef_1 = key;
                }
            });
            if (badRef_1 !== null) {
                extraWarning =
                    " Mutable values like '" + badRef_1 + "' aren't valid dependencies " +
                        "because mutating them doesn't re-render the component.";
            }
            else if (externalDependencies.size > 0) {
                var dep = Array.from(externalDependencies)[0];
                var binding = scope.getBinding(dep);
                // Don't show this warning for things that likely just got moved *inside* the callback
                // because in that case they're clearly not referring to globals.
                if (binding == null || binding[1] !== scope) {
                    extraWarning =
                        " Outer scope values like '" + dep + "' aren't valid dependencies " +
                            "because mutating them doesn't re-render the component.";
                }
            }
        }
        // `props.foo()` marks `props` as a dependency because it has
        // a `this` value. This warning can be confusing.
        // So if we're going to show it, append a clarification.
        if (!extraWarning && missingDependencies.has('props')) {
            var propDep = dependencies.get('props');
            if (propDep == null) {
                return;
            }
            var refs = propDep.references;
            if (!Array.isArray(refs)) {
                return;
            }
            var isPropsOnlyUsedInMembers = true;
            for (var _i = 0, refs_1 = refs; _i < refs_1.length; _i++) {
                var ref = refs_1[_i];
                var id = fastFindReferenceWithParent(componentScope.getDeclaringNode(), ref.identifier);
                if (!id) {
                    isPropsOnlyUsedInMembers = false;
                    break;
                }
                var parent = id.parent;
                if (parent == null) {
                    isPropsOnlyUsedInMembers = false;
                    break;
                }
                if (!ts.isPropertyAccessExpression(parent) && !ts.isElementAccessExpression(parent)) {
                    isPropsOnlyUsedInMembers = false;
                    break;
                }
            }
            if (isPropsOnlyUsedInMembers) {
                extraWarning =
                    " However, 'props' will change when *any* prop changes, so the " +
                        "preferred fix is to destructure the 'props' object outside of " +
                        ("the " + reactiveHookName + " call and refer to those specific props ") +
                        ("inside " + reactiveHook.getText() + ".");
            }
        }
        if (!extraWarning && missingDependencies.size > 0) {
            // See if the user is trying to avoid specifying a callable prop.
            // This usually means they're unaware of useCallback.
            var missingCallbackDep_1 = null;
            missingDependencies.forEach(function (missingDep) {
                if (missingCallbackDep_1) {
                    return;
                }
                // Is this a variable from top scope?
                var topScopeRef = nonNullableComponentScope.getBinding(missingDep);
                var usedDep = dependencies.get(missingDep);
                if (usedDep == null || topScopeRef == null) {
                    return;
                }
                if (usedDep.references[0].referenceTo.binding !== topScopeRef[0]) {
                    return;
                }
                // Is this a destructured prop?
                var def = topScopeRef[0].declaringNode;
                if (!ts.isParameter(def)) {
                    return;
                }
                // Was it called in at least one case? Then it's a function.
                var isFunctionCall = false;
                for (var _i = 0, _a = usedDep.references; _i < _a.length; _i++) {
                    var id = _a[_i].identifier;
                    if (id != null &&
                        id.parent != null &&
                        ts.isCallExpression(id.parent) &&
                        id.parent.expression === id) {
                        isFunctionCall = true;
                        break;
                    }
                }
                if (!isFunctionCall) {
                    return;
                }
                // If it's missing (i.e. in component scope) *and* it's a parameter
                // then it is definitely coming from props destructuring.
                // (It could also be props itself but we wouldn't be calling it then.)
                missingCallbackDep_1 = missingDep;
            });
            if (missingCallbackDep_1 !== null) {
                extraWarning =
                    " If '" + missingCallbackDep_1 + "' changes too often, " +
                        "find the parent component that defines it " +
                        "and wrap that definition in useCallback.";
            }
        }
        if (!extraWarning && missingDependencies.size > 0) {
            var setStateRecommendation = null;
            for (var _a = 0, _b = Array.from(missingDependencies); _a < _b.length; _a++) {
                var missingDep = _b[_a];
                if (setStateRecommendation !== null) {
                    break;
                }
                var usedDep = dependencies.get(missingDep);
                if (usedDep == null) {
                    break;
                }
                var references = usedDep.references;
                for (var _c = 0, references_1 = references; _c < references_1.length; _c++) {
                    var _d = references_1[_c], id = _d.identifier, referenceTo = _d.referenceTo;
                    var maybeCall = id.parent;
                    // Try to see if we have setState(someExpr(missingDep)).
                    while (maybeCall != null && maybeCall !== nonNullableComponentScope.getDeclaringNode()) {
                        if (ts.isCallExpression(maybeCall)) {
                            var correspondingStateVariable = this.setStateCallSites.get(maybeCall.expression);
                            if (correspondingStateVariable != null) {
                                if (ts.isBindingElement(correspondingStateVariable) &&
                                    ts.isIdentifier(correspondingStateVariable.name) &&
                                    correspondingStateVariable.name.text === missingDep) {
                                    // setCount(count + 1)
                                    setStateRecommendation = {
                                        form: 'updater',
                                        missingDep: missingDep,
                                        setter: maybeCall.expression.getText(),
                                    };
                                }
                                else if (this.stateVariables.has(id)) {
                                    // setCount(count + increment)
                                    setStateRecommendation = {
                                        form: 'reducer',
                                        missingDep: missingDep,
                                        setter: maybeCall.expression.getText(),
                                    };
                                }
                                else {
                                    // If it's a parameter *and* a missing dep,
                                    // it must be a prop or something inside a prop.
                                    // Therefore, recommend an inline reducer.
                                    var def = referenceTo.binding.declaringNode;
                                    if (ts.isParameter(def)) {
                                        setStateRecommendation = {
                                            form: 'inlineReducer',
                                            missingDep: missingDep,
                                            setter: maybeCall.expression.getText(),
                                        };
                                    }
                                }
                                break;
                            }
                        }
                        maybeCall = maybeCall.parent;
                    }
                    if (setStateRecommendation !== null) {
                        break;
                    }
                }
            }
            if (setStateRecommendation != null) {
                switch (setStateRecommendation.form) {
                    case 'reducer':
                        extraWarning =
                            " You can also replace multiple useState variables with useReducer " +
                                ("if '" + setStateRecommendation.setter + "' needs the ") +
                                ("current value of '" + setStateRecommendation.missingDep + "'.");
                        break;
                    case 'inlineReducer':
                        extraWarning =
                            " If '" + setStateRecommendation.setter + "' needs the " +
                                ("current value of '" + setStateRecommendation.missingDep + "', ") +
                                "you can also switch to useReducer instead of useState and " +
                                ("read '" + setStateRecommendation.missingDep + "' in the reducer.");
                        break;
                    case 'updater':
                        extraWarning =
                            " You can also do a functional update '" + setStateRecommendation.setter + "(" + setStateRecommendation.missingDep.substring(0, 1) + " => ...)' if you only need '" + setStateRecommendation.missingDep + "'" + (" in the '" + setStateRecommendation.setter + "' call.");
                        break;
                    default:
                        throw new Error('Unknown case.');
                }
            }
        }
        this.addFailureAtNode(declaredDependenciesNode, "React Hook " + reactiveHook.getText() + " has " +
            // To avoid a long message, show the next actionable item.
            (getWarningMessage(missingDependencies, 'a', 'missing', 'include') ||
                getWarningMessage(unnecessaryDependencies, 'an', 'unnecessary', 'exclude') ||
                getWarningMessage(duplicateDependencies, 'a', 'duplicate', 'omit')) +
            extraWarning);
    };
    ReactHooksExhaustiveDeps.prototype.visitArrowFunction = function (arrowExpr) {
        this.visitFunctionLikeExpression(arrowExpr);
        _super.prototype.visitArrowFunction.call(this, arrowExpr);
    };
    ReactHooksExhaustiveDeps.prototype.visitFunctionExpression = function (funcExpr) {
        this.visitFunctionLikeExpression(funcExpr);
        _super.prototype.visitFunctionExpression.call(this, funcExpr);
    };
    return ReactHooksExhaustiveDeps;
}(Lint.RuleWalker));
exports.ReactHooksExhaustiveDeps = ReactHooksExhaustiveDeps;
/**
 * What's the index of callback that needs to be analyzed for a given Hook?
 * -2 if it is not a hook
 * -1 if it's not a Hook we care about (e.g. useState).
 * 0 for useEffect/useMemo/useCallback(fn).
 * 1 for useImperativeHandle(ref, fn).
 * For additionally configured Hooks, assume that they're like useEffect (0).
 */
function getReactiveHookCallbackIndex(calleeNode, options) {
    var node = getNodeWithoutReactNamespace(calleeNode, options);
    if (node == null || !ts.isIdentifier(node)) {
        return -2;
    }
    switch (node.text) {
        case 'useEffect':
        case 'useLayoutEffect':
        case 'useCallback':
        case 'useMemo':
            // useEffect(fn)
            return 0;
        case 'useImperativeHandle':
            // useImperativeHandle(ref, fn)
            return 1;
        default:
            if (node === calleeNode && options && options.additionalHooks) {
                // Allow the user to provide a regular expression which enables the lint to
                // target custom reactive hooks.
                var name = void 0;
                try {
                    name = toPropertyAccessString(node);
                }
                catch (error) {
                    if (/Unsupported node type/.test(error.message)) {
                        return 0;
                    }
                    else {
                        throw error;
                    }
                }
                return options.additionalHooks.test(name) ? 0 : -1;
            }
            else {
                return -1;
            }
    }
}
function joinEnglish(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) {
        s += arr[i];
        if (i === 0 && arr.length === 2) {
            s += ' and ';
        }
        else if (i === arr.length - 2 && arr.length > 2) {
            s += ', and ';
        }
        else if (i < arr.length - 1) {
            s += ', ';
        }
    }
    return s;
}
function isSameIdentifier(a, b) {
    return a === b;
}
function isAncestorNodeOf(a, b) {
    return a.getStart() <= b.getStart() && a.getEnd() >= b.getEnd();
}
/**
 * This seems to deal with various side effects in the original lint rule.
 * For now let's just assume this works as intended.
 * It seems sometimes the eslint stuff won't assign .parent as intended
 * this is not an issue for us.
 */
function fastFindReferenceWithParent(start, target) {
    var queue = [start];
    var item = null;
    while (queue.length) {
        item = queue.shift();
        if (item == null) {
            return null;
        }
        if (isSameIdentifier(item, target)) {
            return item;
        }
        if (!isAncestorNodeOf(item, target)) {
            continue;
        }
        ts.forEachChild(item, function (value) {
            if (isNodeLike(value)) {
                queue.push(value);
            }
        });
    }
    return null;
}
function getNodeWithoutReactNamespace(node, options) {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'React') {
        return node.name;
    }
    if (ts.isIdentifier(node)) {
        return node;
    }
    return null;
}
function isAsync(funcExpr) {
    return funcExpr.modifiers == null ? false : funcExpr.modifiers.some(function (x) { return x.kind === ts.SyntaxKind.AsyncKeyword; });
}
/**
 * Assuming () means the passed node.
 * (foo) -> 'foo'
 * foo.(bar) -> 'foo.bar'
 * foo.bar.(baz) -> 'foo.bar.baz'
 * Otherwise throw.
 */
function toPropertyAccessString(node) {
    if (ts.isIdentifier(node)) {
        return node.text;
    }
    else if (ts.isPropertyAccessExpression(node)) {
        var object = toPropertyAccessString(node.expression);
        var property = toPropertyAccessString(node.name);
        return object + "." + property;
    }
    else {
        throw new Error("Unsupported node type: " + ts.SyntaxKind[node.kind]);
    }
}
function isNodeLike(nodeLike) {
    return nodeLike != null && nodeLike.kind != null && ts.SyntaxKind[nodeLike.kind] != null;
}
/**
 * Assuming () means the passed/returned node:
 * (props) => (props)
 * props.(foo) => (props.foo)
 * props.foo.(bar) => (props).foo.bar
 * props.foo.bar.(baz) => (props).foo.bar.baz
 */
function getDependency(node) {
    if (ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node &&
        node.parent.name.text !== 'current' &&
        !(node.parent.parent != null &&
            ts.isCallExpression(node.parent.parent) &&
            node.parent.parent.expression === node.parent)) {
        return getDependency(node.parent);
    }
    else {
        return node;
    }
}
function memoizeWithWeakMap(fn, map) {
    return function (arg) {
        var val = map.get(arg);
        if (val !== undefined) {
            return val;
        }
        var result = fn(arg);
        map.set(arg, result);
        return result;
    };
}
function isConstVariableDeclaration(decl) {
    // tslint:disable-next-line:no-bitwise
    return (decl.flags & ts.NodeFlags.Const) !== 0;
}
// The meat of the logic.
function collectRecommendations(_a) {
    var declaredDependencies = _a.declaredDependencies, dependencies = _a.dependencies, optionalDependencies = _a.optionalDependencies, externalDependencies = _a.externalDependencies, isEffect = _a.isEffect;
    // Our primary data structure.
    // It is a logical representation of property chains:
    // `props` -> `props.foo` -> `props.foo.bar` -> `props.foo.bar.baz`
    //         -> `props.lol`
    //         -> `props.huh` -> `props.huh.okay`
    //         -> `props.wow`
    // We'll use it to mark nodes that are *used* by the programmer,
    // and the nodes that were *declared* as deps. Then we will
    // traverse it to learn which deps are missing or unnecessary.
    var depTree = createDepTree();
    function createDepTree() {
        return {
            children: new Map(),
            hasRequiredNodesBelow: false,
            isRequired: false,
            isSatisfiedRecursively: false,
        };
    }
    // Mark all required nodes first.
    // Imagine exclamation marks next to each used deep property.
    dependencies.forEach(function (_, key) {
        var node = getOrCreateNodeByPath(depTree, key);
        node.isRequired = true;
        markAllParentsByPath(depTree, key, function (parent) {
            parent.hasRequiredNodesBelow = true;
        });
    });
    // Mark all satisfied nodes.
    // Imagine checkmarks next to each declared dependency.
    declaredDependencies.forEach(function (_a) {
        var key = _a.key;
        var node = getOrCreateNodeByPath(depTree, key);
        node.isSatisfiedRecursively = true;
    });
    optionalDependencies.forEach(function (key) {
        var node = getOrCreateNodeByPath(depTree, key);
        node.isSatisfiedRecursively = true;
    });
    // Tree manipulation helpers.
    function getOrCreateNodeByPath(rootNode, path) {
        var keys = path.split('.');
        var node = rootNode;
        for (var _i = 0, keys_1 = keys; _i < keys_1.length; _i++) {
            var key = keys_1[_i];
            var child = node.children.get(key);
            if (!child) {
                child = createDepTree();
                node.children.set(key, child);
            }
            node = child;
        }
        return node;
    }
    function markAllParentsByPath(rootNode, path, fn) {
        var keys = path.split('.');
        var node = rootNode;
        for (var _i = 0, keys_2 = keys; _i < keys_2.length; _i++) {
            var key = keys_2[_i];
            var child = node.children.get(key);
            if (!child) {
                return;
            }
            fn(child);
            node = child;
        }
    }
    // Now we can learn which dependencies are missing or necessary.
    var missingDependencies = new Set();
    var satisfyingDependencies = new Set();
    scanTreeRecursively(depTree, missingDependencies, satisfyingDependencies, function (key) { return key; });
    function scanTreeRecursively(node, missingPaths, satisfyingPaths, keyToPath) {
        node.children.forEach(function (child, key) {
            var path = keyToPath(key);
            if (child.isSatisfiedRecursively) {
                if (child.hasRequiredNodesBelow) {
                    // Remember this dep actually satisfied something.
                    satisfyingPaths.add(path);
                }
                // It doesn't matter if there's something deeper.
                // It would be transitively satisfied since we assume immutability.
                // `props.foo` is enough if you read `props.foo.id`.
                return;
            }
            if (child.isRequired) {
                // Remember that no declared deps satisfied this node.
                missingPaths.add(path);
                // If we got here, nothing in its subtree was satisfied.
                // No need to search further.
                return;
            }
            scanTreeRecursively(child, missingPaths, satisfyingPaths, function (childKey) { return path + '.' + childKey; });
        });
    }
    // Collect suggestions in the order they were originally specified.
    var suggestedDependencies = [];
    var unnecessaryDependencies = new Set();
    var duplicateDependencies = new Set();
    declaredDependencies.forEach(function (_a) {
        var key = _a.key;
        // Does this declared dep satisfy a real need?
        if (satisfyingDependencies.has(key)) {
            if (suggestedDependencies.indexOf(key) === -1) {
                // Good one.
                suggestedDependencies.push(key);
            }
            else {
                // Duplicate.
                duplicateDependencies.add(key);
            }
        }
        else {
            if (isEffect && !key.endsWith('.current') && !externalDependencies.has(key)) {
                // Effects are allowed extra "unnecessary" deps.
                // Such as resetting scroll when ID changes.
                // Consider them legit.
                // The exception is ref.current which is always wrong.
                if (suggestedDependencies.indexOf(key) === -1) {
                    suggestedDependencies.push(key);
                }
            }
            else {
                // It's definitely not needed.
                unnecessaryDependencies.add(key);
            }
        }
    });
    // Then add the missing ones at the end.
    missingDependencies.forEach(function (key) {
        suggestedDependencies.push(key);
    });
    return {
        duplicateDependencies: duplicateDependencies,
        missingDependencies: missingDependencies,
        suggestedDependencies: suggestedDependencies,
        unnecessaryDependencies: unnecessaryDependencies,
    };
}
// Finds functions declared as dependencies
// that would invalidate on every render.
function scanForDeclaredBareFunctions(_a) {
    var declaredDependencies = _a.declaredDependencies, declaredDependenciesNode = _a.declaredDependenciesNode, componentScope = _a.componentScope, scope = _a.scope;
    var bareFunctions = declaredDependencies
        .map(function (_a) {
        var key = _a.key;
        var binding = componentScope.getBinding(key);
        if (binding == null || binding[1] !== componentScope) {
            return null;
        }
        var fnRef = binding[0];
        var fnNode = fnRef.declaringNode;
        if (fnNode == null) {
            return null;
        }
        // const handleChange = function () {}
        // const handleChange = () => {}
        if (ts.isVariableDeclaration(fnNode) &&
            fnNode.initializer != null &&
            (ts.isArrowFunction(fnNode.initializer) || ts.isFunctionExpression(fnNode.initializer))) {
            return fnRef;
        }
        // function handleChange() {}
        if (ts.isFunctionDeclaration(fnNode)) {
            return fnRef;
        }
        return null;
    })
        .filter(Boolean);
    function isUsedOutsideOfHook(fnRef) {
        var foundWriteExpr = false;
        for (var _i = 0, _a = fnRef.references; _i < _a.length; _i++) {
            var reference = _a[_i];
            if (reference.writeExpr) {
                if (foundWriteExpr) {
                    // Two writes to the same function.
                    return true;
                }
                else {
                    // Ignore first write as it's not usage.
                    foundWriteExpr = true;
                    continue;
                }
            }
            var currentScope = reference.referencedFromScope;
            while (currentScope !== scope && currentScope != null) {
                currentScope = currentScope.getParentScope();
            }
            if (currentScope !== scope) {
                // This reference is outside the Hook callback.
                // It can only be legit if it's the deps array.
                if (!isAncestorNodeOf(declaredDependenciesNode, reference.identifier)) {
                    return true;
                }
            }
        }
        return false;
    }
    return bareFunctions.map(function (fnRef) { return ({
        fn: fnRef,
        suggestUseCallback: isUsedOutsideOfHook(fnRef),
    }); });
}
function getParentScopes(scope) {
    var parentScope = scope.getParentScope();
    var scopes = new Set();
    while (parentScope != null) {
        scopes.add(parentScope);
        parentScope = parentScope.getParentScope();
    }
    return scopes;
}
function getDeclaringExpr(declaringNode) {
    if (ts.isVariableDeclaration(declaringNode) && declaringNode.initializer != null) {
        return declaringNode.initializer;
    }
    return declaringNode;
}
function unwrapNonSemanticExpressions(exp) {
    if (exp == null) {
        return exp;
    }
    if (ts.isAsExpression(exp)) {
        return unwrapNonSemanticExpressions(exp.expression);
    }
    if (ts.isParenthesizedExpression(exp)) {
        return unwrapNonSemanticExpressions(exp.expression);
    }
    return exp;
}
