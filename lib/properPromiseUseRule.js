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
var Lint = require("tslint");
var ts = require("typescript");
var Rule = /** @class */ (function (_super) {
    __extends(Rule, _super);
    function Rule() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    Rule.prototype.applyWithProgram = function (sourceFile, program) {
        return this.applyWithWalker(new ProperPromiseUse(sourceFile, { ruleName: 'proper-promise-use', ruleArguments: [], ruleSeverity: 'error', disabledIntervals: [] }, program));
    };
    Rule.metadata = {
        description: 'Warns about sketchy promise usage. ' +
            'It is assumed that any promise will take an arbitrary amount of time to succeed or fail ' +
            '- and that all promises want to be handled.',
        optionExamples: [],
        options: {},
        optionsDescription: '',
        rationale: 'We want to ensure (or attempt to ensure) that all promises have been handled. Ie. ' +
            " we don't want any warnings about unhandled promise rejections.",
        requiresTypeInfo: true,
        ruleName: 'proper-promise-use',
        type: 'typescript',
        typescriptOnly: false,
    };
    Rule.FAILURE_STRING_BLOCK_CONSISTENCY = function (promiseVar) {
        return "Promise \"" + promiseVar.getText() + "\" is created in a different block than it is handled in.";
    };
    Rule.FAILURE_STRING_CLOSURE_SCOPING = function (promiseVar) {
        return "Use of closure scoped promise \"" + promiseVar.getText() + "\" is not allowed.";
    };
    Rule.FAILURE_STRING_CONDITIONAL = function (promiseVar) {
        return "Handling of \"" + promiseVar.getText() + "\" is guarded by a condition. It must be handled unconditionally.";
    };
    Rule.FAILURE_STRING_CONTROL_EXITS = function (promiseId) {
        return "Control flow exits - \"" + promiseId.getText() + "\" must be handled first.";
    };
    Rule.FAILURE_STRING_DEPENDS_ON_OTHER_AWAIT = function (promiseId) {
        return "Existing promise \"" + promiseId.getText() + "\" needs to be included in this await expression, eg. use `Promise.all`.";
    };
    Rule.FAILURE_STRING_MISSING_AWAIT = function (promiseExpr) {
        return "Promise \"" + promiseExpr.getText() + "\" must be handled.";
    };
    Rule.FAILURE_STRING_RETURN_OUT_OF_TRY_CATCH_BLOCK = function (promiseExpr, failingBlock) {
        var promiseText = promiseExpr.getText();
        var sourceFile = failingBlock.getSourceFile();
        var startingLine = sourceFile.getLineAndCharacterOfPosition(failingBlock.getStart()).line + 1;
        var endingLine = sourceFile.getLineAndCharacterOfPosition(failingBlock.getEnd()).line + 1;
        return ("Promise \"" + promiseText + "\" being directly returned here prevents the block " +
            ("at line " + startingLine + "-" + endingLine + " to track completion of the promise."));
    };
    return Rule;
}(Lint.Rules.TypedRule));
exports.Rule = Rule;
var ProperPromiseUse = /** @class */ (function (_super) {
    __extends(ProperPromiseUse, _super);
    function ProperPromiseUse(sourceFile, options, program) {
        var _this = _super.call(this, sourceFile, options) || this;
        _this.blockLevel = 0;
        _this.conditions = [];
        _this.scopes = [{ awaitUsages: 0, scopeBlockLevel: 0, promises: new Map(), tryCatchBlocks: [] }];
        _this.typeChecker = program.getTypeChecker();
        return _this;
    }
    ProperPromiseUse.prototype.addPromiseVariable = function (id) {
        var scope = this.currentScopePromises();
        scope.set(id.getText(), {
            blockLevel: this.blockLevel,
            declNode: id,
        });
    };
    ProperPromiseUse.prototype.blockPreventingSafeReturn = function () {
        var functionScope = this.currentFunctionScope();
        if (functionScope == null) {
            return null;
        }
        for (var _i = 0, _a = functionScope.tryCatchBlocks; _i < _a.length; _i++) {
            var tryCatchBlock = _a[_i];
            var catchClause = tryCatchBlock.tryStatement.catchClause;
            var finallyBlock = tryCatchBlock.tryStatement.finallyBlock;
            if (finallyBlock != null && tryCatchBlock.state !== 2 /* Finally */) {
                return finallyBlock;
            }
            if (catchClause != null && tryCatchBlock.state === 0 /* Try */) {
                return catchClause.block;
            }
        }
        return null;
    };
    ProperPromiseUse.prototype.currentFunctionScope = function () {
        for (var i = this.scopes.length - 1; i >= 0; i--) {
            var scope = this.scopes[i];
            if (scope.functionDecl != null) {
                return scope;
            }
        }
        return null;
    };
    ProperPromiseUse.prototype.currentScopePromises = function () {
        return this.scopes[this.scopes.length - 1].promises;
    };
    ProperPromiseUse.prototype.enterAwaitLikeExpression = function () {
        this.scopes[this.scopes.length - 1].awaitUsages++;
    };
    ProperPromiseUse.prototype.enterBlock = function () {
        this.blockLevel++;
    };
    ProperPromiseUse.prototype.enterCondition = function (condition) {
        this.conditions.push({ scopeBlockLevel: this.blockLevel, node: condition, errorInConditionals: false });
    };
    ProperPromiseUse.prototype.enterScope = function (functionDecl) {
        this.blockLevel++;
        this.scopes.push({
            awaitUsages: 0,
            functionDecl: functionDecl,
            promises: new Map(),
            scopeBlockLevel: this.blockLevel,
            tryCatchBlocks: [],
        });
    };
    ProperPromiseUse.prototype.exitAwaitLikeExpression = function () {
        this.scopes[this.scopes.length - 1].awaitUsages--;
    };
    ProperPromiseUse.prototype.exitBlock = function () {
        this.blockLevel--;
    };
    ProperPromiseUse.prototype.exitCondition = function () {
        var condition = this.conditions.pop();
        if (condition == null) {
            return;
        }
        if (!condition.errorInConditionals && isNodePromiseType(condition.node, this.typeChecker)) {
            // Let's attempt to find the concrete branch inside logical ands and ors where this has gone wrong
            var failureNode = condition.node;
            while (ts.isBinaryExpression(failureNode)) {
                if (isNodePromiseType(failureNode.left, this.typeChecker)) {
                    failureNode = failureNode.left;
                }
                else if (isNodePromiseType(failureNode.right, this.typeChecker)) {
                    failureNode = failureNode.right;
                }
                else {
                    break;
                }
            }
            this.addFailureAtNode(failureNode, Rule.FAILURE_STRING_MISSING_AWAIT(failureNode));
            this.conditions.forEach(function (c) { return (c.errorInConditionals = true); });
        }
    };
    ProperPromiseUse.prototype.exitScope = function () {
        this.failCurrentScopeUnhandled();
        this.blockLevel--;
        this.scopes.pop();
    };
    ProperPromiseUse.prototype.failCurrentScope = function (problemNode, failureString) {
        var _this = this;
        var promises = this.currentScopePromises();
        promises.forEach(function (_a) {
            var declNode = _a.declNode;
            _this.addFailureAtNode(problemNode, failureString(declNode));
        });
        promises.clear();
    };
    ProperPromiseUse.prototype.failCurrentScopeUnhandled = function () {
        var _this = this;
        var promises = this.currentScopePromises();
        promises.forEach(function (_a) {
            var declNode = _a.declNode;
            _this.addFailureAtNode(declNode, Rule.FAILURE_STRING_MISSING_AWAIT(declNode));
        });
        promises.clear();
    };
    ProperPromiseUse.prototype.getScopeAndPromiseUsage = function (variableName) {
        for (var _i = 0, _a = this.scopes; _i < _a.length; _i++) {
            var scope = _a[_i];
            var promiseUsage = scope.promises.get(variableName);
            if (promiseUsage != null) {
                return {
                    declNode: promiseUsage.declNode,
                    scope: scope.promises,
                };
            }
        }
        return null;
    };
    ProperPromiseUse.prototype.isAwaiting = function () {
        return this.scopes[this.scopes.length - 1].awaitUsages > 0;
    };
    ProperPromiseUse.prototype.isConditioned = function (promiseVar) {
        var scope = this.currentScopePromises();
        var varInfo = scope.get(promiseVar);
        if (varInfo == null) {
            return false;
        }
        return (this.conditions.length > 0 &&
            this.conditions[this.conditions.length - 1].scopeBlockLevel === varInfo.blockLevel);
    };
    // private isCurrentFunctionAsync(): boolean {
    // 	const functionScope = this.currentFunctionScope();
    // 	if (functionScope == null) {
    // 		return false;
    // 	}
    // 	return (
    // 		functionScope.functionDecl.modifiers != null &&
    // 		functionScope.functionDecl.modifiers.some(x => x.kind === ts.SyntaxKind.AsyncKeyword)
    // 	);
    // }
    ProperPromiseUse.prototype.getCondition = function (promiseVar) {
        if (!this.isConditioned(promiseVar)) {
            throw new Error('Invalid request');
        }
        return this.conditions[this.conditions.length - 1].node;
    };
    ProperPromiseUse.prototype.visitArrowFunction = function (arrowFunc) {
        this.enterScope(arrowFunc);
        _super.prototype.visitArrowFunction.call(this, arrowFunc);
        this.exitScope();
    };
    ProperPromiseUse.prototype.visitAwaitExpression = function (awaitExp) {
        this.enterAwaitLikeExpression();
        this.visitNode(awaitExp.expression);
        this.exitAwaitLikeExpression();
        this.failCurrentScope(awaitExp, Rule.FAILURE_STRING_DEPENDS_ON_OTHER_AWAIT);
    };
    ProperPromiseUse.prototype.visitBinaryExpression = function (binExp) {
        var op = binExp.operatorToken.getText();
        if (['=', '||', '&&'].indexOf(op) < 0) {
            return _super.prototype.visitBinaryExpression.call(this, binExp);
        }
        if (op === '=') {
            var lhs = binExp.left;
            var rhs = binExp.right;
            if (ts.isIdentifier(lhs) &&
                (isNodePromiseType(lhs, this.typeChecker) || isNodePromiseType(rhs, this.typeChecker))) {
                this.visitNode(rhs);
                this.addPromiseVariable(lhs);
                return;
            }
            _super.prototype.visitBinaryExpression.call(this, binExp);
            return;
        }
        // now we're && or ||
        this.visitNode(binExp.left);
        this.enterCondition(binExp.left);
        this.visitNode(binExp.right);
        this.exitCondition();
    };
    ProperPromiseUse.prototype.visitBlock = function (block) {
        var isFunctionBlock = block.parent != null && ts.isFunctionLike(block.parent);
        if (!isFunctionBlock) {
            this.enterBlock();
        }
        _super.prototype.visitBlock.call(this, block);
        if (!isFunctionBlock) {
            this.exitBlock();
        }
    };
    ProperPromiseUse.prototype.visitCallExpression = function (call) {
        var _this = this;
        var isPromise = isNodePromiseType(call, this.typeChecker);
        if (isPromise) {
            this.visitNode(call.expression);
            // We treat treat functions arguments to functions generating promises
            // as though we're awaiting on them,
            // except that multiples are considered handled in parrallel
            this.enterAwaitLikeExpression();
            call.arguments.forEach(function (node) { return _this.visitNode(node); });
            this.exitAwaitLikeExpression();
            return;
        }
        _super.prototype.visitCallExpression.call(this, call);
    };
    ProperPromiseUse.prototype.visitConditionalExpression = function (condExp) {
        this.visitNode(condExp.condition);
        this.enterCondition(condExp.condition);
        this.visitNode(condExp.whenTrue);
        this.visitNode(condExp.whenFalse);
        this.exitCondition();
    };
    ProperPromiseUse.prototype.visitConstructorDeclaration = function (constructorDecl) {
        this.enterScope(constructorDecl);
        _super.prototype.visitConstructorDeclaration.call(this, constructorDecl);
        this.exitScope();
    };
    ProperPromiseUse.prototype.visitDoStatement = function (doStatement) {
        this.enterCondition(doStatement.expression);
        this.enterBlock();
        this.visitNode(doStatement.statement);
        this.exitBlock();
        this.exitCondition();
        this.visitNode(doStatement.expression);
    };
    ProperPromiseUse.prototype.visitForInStatement = function (forInStmt) {
        this.visitNode(forInStmt.initializer);
        this.visitNode(forInStmt.expression);
        this.enterCondition(forInStmt.expression);
        this.visitNode(forInStmt.statement);
        this.exitCondition();
    };
    ProperPromiseUse.prototype.visitForOfStatement = function (forInStmt) {
        this.visitNode(forInStmt.initializer);
        this.visitNode(forInStmt.expression);
        this.enterCondition(forInStmt.expression);
        this.visitNode(forInStmt.statement);
        this.exitCondition();
    };
    ProperPromiseUse.prototype.visitForStatement = function (forStmt) {
        if (forStmt.initializer != null) {
            this.visitNode(forStmt.initializer);
        }
        if (forStmt.condition != null) {
            this.visitNode(forStmt.condition);
            this.enterCondition(forStmt.condition);
        }
        if (forStmt.statement != null) {
            this.visitNode(forStmt.statement);
        }
        if (forStmt.incrementor != null) {
            this.visitNode(forStmt.incrementor);
        }
        if (forStmt.condition != null) {
            this.exitCondition();
        }
    };
    ProperPromiseUse.prototype.visitFunctionDeclaration = function (funcDecl) {
        this.enterScope(funcDecl);
        _super.prototype.visitFunctionDeclaration.call(this, funcDecl);
        this.exitScope();
    };
    ProperPromiseUse.prototype.visitFunctionExpression = function (funcExp) {
        this.enterScope(funcExp);
        _super.prototype.visitFunctionExpression.call(this, funcExp);
        this.exitScope();
    };
    ProperPromiseUse.prototype.visitGetAccessor = function (getAccessor) {
        this.enterScope(getAccessor);
        _super.prototype.visitGetAccessor.call(this, getAccessor);
        this.exitScope();
    };
    ProperPromiseUse.prototype.visitIdentifier = function (id) {
        var scope = this.currentScopePromises();
        var promiseType = scope.get(id.getText());
        if (promiseType != null) {
            if (isNodePromiseArrayType(id, this.typeChecker) && isArrayPropertyAccess(id)) {
                return _super.prototype.visitIdentifier.call(this, id);
            }
            if (this.isConditioned(id.getText())) {
                this.addFailureAtNode(id, Rule.FAILURE_STRING_CONDITIONAL(promiseType.declNode));
                scope.delete(id.getText());
                return;
            }
            if (this.isAwaiting()) {
                if (promiseType.blockLevel === this.blockLevel) {
                    scope.delete(id.getText());
                }
                else {
                    this.addFailureAtNode(id, Rule.FAILURE_STRING_BLOCK_CONSISTENCY(id));
                    scope.delete(id.getText());
                }
            }
            else {
                this.addFailureAtNode(promiseType.declNode, Rule.FAILURE_STRING_MISSING_AWAIT(promiseType.declNode));
                scope.delete(id.getText());
            }
        }
        if (this.isAwaiting()) {
            var info = this.getScopeAndPromiseUsage(id.getText());
            if (info != null) {
                this.addFailureAtNode(id, Rule.FAILURE_STRING_CLOSURE_SCOPING(id));
                info.scope.delete(info.declNode.getText());
            }
        }
        _super.prototype.visitIdentifier.call(this, id);
    };
    ProperPromiseUse.prototype.visitIfStatement = function (ifStmt) {
        this.visitNode(ifStmt.expression);
        this.enterCondition(ifStmt.expression);
        this.visitNode(ifStmt.thenStatement);
        if (ifStmt.elseStatement != null) {
            this.visitNode(ifStmt.elseStatement);
        }
        this.exitCondition();
    };
    ProperPromiseUse.prototype.visitMethodDeclaration = function (methodDecl) {
        this.enterScope(methodDecl);
        _super.prototype.visitMethodDeclaration.call(this, methodDecl);
        this.exitScope();
    };
    ProperPromiseUse.prototype.visitNode = function (node) {
        if (ts.isAwaitExpression(node)) {
            return this.visitAwaitExpression(node);
        }
        _super.prototype.visitNode.call(this, node);
    };
    ProperPromiseUse.prototype.visitParameterDeclaration = function (paramDecl) {
        if (!ts.isIdentifier(paramDecl.name)) {
            return _super.prototype.visitParameterDeclaration.call(this, paramDecl);
        }
        var id = paramDecl.name;
        _super.prototype.visitParameterDeclaration.call(this, paramDecl);
        if (isNodePromiseType(id, this.typeChecker)) {
            this.addPromiseVariable(id);
        }
    };
    ProperPromiseUse.prototype.visitReturnStatement = function (returnStmt) {
        // We count returns as awaits, they function more or less the same for our purpose
        this.enterAwaitLikeExpression();
        _super.prototype.visitReturnStatement.call(this, returnStmt);
        this.exitAwaitLikeExpression();
        // Now - our most important exception is that we're not allowed to return a promise if we're inside
        // a try/catch statement. This will prevent catch blocks from catching the exception
        // as well as finally blocks will run before the returned promise has completed
        if (returnStmt.expression != null) {
            var getBlockPreventingSafeReturn = this.blockPreventingSafeReturn();
            if (getBlockPreventingSafeReturn != null && isNodePromiseType(returnStmt.expression, this.typeChecker)) {
                this.addFailureAtNode(returnStmt, Rule.FAILURE_STRING_RETURN_OUT_OF_TRY_CATCH_BLOCK(returnStmt.expression, getBlockPreventingSafeReturn));
            }
        }
        this.failCurrentScope(returnStmt, Rule.FAILURE_STRING_CONTROL_EXITS);
    };
    ProperPromiseUse.prototype.visitSetAccessor = function (setAccessor) {
        this.enterScope(setAccessor);
        _super.prototype.visitSetAccessor.call(this, setAccessor);
        this.exitScope();
    };
    ProperPromiseUse.prototype.visitSwitchStatement = function (switchStmt) {
        this.visitNode(switchStmt.expression);
        this.enterCondition(switchStmt.expression);
        this.enterBlock();
        this.visitNode(switchStmt.caseBlock);
        this.exitBlock();
        this.exitCondition();
    };
    ProperPromiseUse.prototype.visitThrowStatement = function (throwStmt) {
        _super.prototype.visitThrowStatement.call(this, throwStmt);
        this.failCurrentScope(throwStmt, Rule.FAILURE_STRING_CONTROL_EXITS);
    };
    ProperPromiseUse.prototype.visitTryStatement = function (tryStmt) {
        var tryStatementInfo = { tryStatement: tryStmt, state: 0 /* Try */ };
        var functionScope = this.currentFunctionScope();
        if (functionScope != null) {
            functionScope.tryCatchBlocks.push(tryStatementInfo);
        }
        this.visitNode(tryStmt.tryBlock);
        if (tryStmt.catchClause != null) {
            tryStatementInfo.state = 1 /* Catch */;
            this.visitNode(tryStmt.catchClause);
        }
        if (tryStmt.finallyBlock != null) {
            tryStatementInfo.state = 2 /* Finally */;
            this.visitNode(tryStmt.finallyBlock);
        }
        if (functionScope != null) {
            functionScope.tryCatchBlocks.pop();
        }
    };
    ProperPromiseUse.prototype.visitVariableDeclaration = function (decl) {
        if (decl.initializer != null) {
            _super.prototype.visitVariableDeclaration.call(this, decl);
        }
        else {
            this.visitNode(decl.name);
            return;
        }
        var binding = decl.name;
        if (!ts.isIdentifier(binding)) {
            return;
        }
        var isPromise = isNodePromiseType(decl.initializer, this.typeChecker) || isNodePromiseType(binding, this.typeChecker);
        if (isPromise) {
            this.addPromiseVariable(binding);
        }
    };
    ProperPromiseUse.prototype.visitWhileStatement = function (whileStmt) {
        this.visitNode(whileStmt.expression);
        this.enterCondition(whileStmt.expression);
        this.enterBlock();
        this.visitNode(whileStmt.statement);
        this.exitBlock();
        this.exitCondition();
    };
    return ProperPromiseUse;
}(Lint.RuleWalker));
exports.ProperPromiseUse = ProperPromiseUse;
function isNodePromiseType(node, typeChecker) {
    var exprType = typeChecker.getTypeAtLocation(node);
    var typeNode = typeChecker.typeToTypeNode(typeChecker.getNonNullableType(exprType));
    if (typeNode == null) {
        return false;
    }
    return isPromiseType(typeNode) || isPromiseArrayType(typeNode);
}
function isNodePromiseArrayType(node, typeChecker) {
    var exprType = typeChecker.getTypeAtLocation(node);
    var typeNode = typeChecker.typeToTypeNode(typeChecker.getNonNullableType(exprType));
    if (typeNode == null) {
        return false;
    }
    return isPromiseArrayType(typeNode);
}
function isPromiseType(typeNode) {
    if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
        return typeNode.types.some(function (x) { return isPromiseType(x); });
    }
    if (ts.isTypeReferenceNode(typeNode)) {
        var name = ts.isIdentifier(typeNode.typeName) ? typeNode.typeName.escapedText : null;
        if (name === 'Promise') {
            return true;
        }
    }
    return isPromiseArrayType(typeNode);
}
function isPromiseArrayType(typeNode) {
    if (ts.isArrayTypeNode(typeNode)) {
        var elementType = typeNode.elementType;
        return isPromiseType(elementType);
    }
    return false;
}
function isArrayPropertyAccess(id) {
    var propertyAccess = id.parent;
    if (propertyAccess != null && ts.isPropertyAccessExpression(propertyAccess) && propertyAccess.expression === id) {
        return true;
    }
    return false;
}
