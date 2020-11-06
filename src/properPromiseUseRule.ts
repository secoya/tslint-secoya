import * as Lint from 'tslint';
import * as ts from 'typescript';

export class Rule extends Lint.Rules.TypedRule {
	public static metadata: Lint.IRuleMetadata = {
		description:
			'Warns about sketchy promise usage. ' +
			'It is assumed that any promise will take an arbitrary amount of time to succeed or fail ' +
			'- and that all promises want to be handled.',
		optionExamples: [],
		options: {},
		optionsDescription: '',
		rationale:
			'We want to ensure (or attempt to ensure) that all promises have been handled. Ie. ' +
			" we don't want any warnings about unhandled promise rejections.",
		requiresTypeInfo: true,
		ruleName: 'proper-promise-use',
		type: 'typescript',
		typescriptOnly: false,
	};
	public static FAILURE_STRING_BLOCK_CONSISTENCY = (promiseVar: ts.Identifier) =>
		`Promise "${promiseVar.getText()}" is created in a different block than it is handled in.`;

	public static FAILURE_STRING_CLOSURE_SCOPING = (promiseVar: ts.Identifier) =>
		`Use of closure scoped promise "${promiseVar.getText()}" is not allowed.`;
	public static FAILURE_STRING_CONDITIONAL = (promiseVar: ts.Identifier) => {
		return `Handling of "${promiseVar.getText()}" is guarded by a condition. It must be handled unconditionally.`;
	};
	public static FAILURE_STRING_CONTROL_EXITS = (promiseId: ts.Identifier) =>
		`Control flow exits - "${promiseId.getText()}" must be handled first.`;
	public static FAILURE_STRING_DEPENDS_ON_OTHER_AWAIT = (promiseId: ts.Identifier) =>
		`Existing promise "${promiseId.getText()}" needs to be included in this await expression, eg. use \`Promise.all\`.`;
	public static FAILURE_STRING_MISSING_AWAIT = (promiseExpr: ts.Node) =>
		`Promise "${promiseExpr.getText()}" must be handled.`;

	public static FAILURE_STRING_RETURN_OUT_OF_TRY_CATCH_BLOCK = (promiseExpr: ts.Node, failingBlock: ts.Block) => {
		const promiseText = promiseExpr.getText();
		const sourceFile = failingBlock.getSourceFile();
		const startingLine = sourceFile.getLineAndCharacterOfPosition(failingBlock.getStart()).line + 1;
		const endingLine = sourceFile.getLineAndCharacterOfPosition(failingBlock.getEnd()).line + 1;
		return (
			`Promise "${promiseText}" being directly returned here prevents the block ` +
			`at line ${startingLine}-${endingLine} to track completion of the promise.`
		);
	};

	public applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program): Lint.RuleFailure[] {
		return this.applyWithWalker(
			new ProperPromiseUse(
				sourceFile,
				{ ruleName: 'proper-promise-use', ruleArguments: [], ruleSeverity: 'error', disabledIntervals: [] },
				program,
			),
		);
	}
}

interface Scope {
	awaitUsages: number;
	functionDecl?: ts.FunctionLikeDeclaration;
	promises: Map<string, { blockLevel: number; declNode: ts.Identifier }>;
	scopeBlockLevel: number;
	tryCatchBlocks: TryStatementInfo[];
}

const enum TryVisitState {
	Try,
	Catch,
	Finally,
}

interface TryStatementInfo {
	state: TryVisitState;
	tryStatement: ts.TryStatement;
}

export class ProperPromiseUse extends Lint.RuleWalker {
	private blockLevel: number = 0;
	private readonly conditions: { errorInConditionals: boolean; node: ts.Node; scopeBlockLevel: number }[] = [];
	private readonly scopes: Scope[] = [{  awaitUsages: 0, scopeBlockLevel: 0, promises: new Map(), tryCatchBlocks: [] }];
	private readonly typeChecker: ts.TypeChecker;

	public constructor(sourceFile: ts.SourceFile, options: Lint.IOptions, program: ts.Program) {
		super(sourceFile, options);
		this.typeChecker = program.getTypeChecker();
	}

	private addPromiseVariable(id: ts.Identifier): void {
		const scope = this.currentScopePromises();
		scope.set(id.getText(), {
			blockLevel: this.blockLevel,
			declNode: id,
		});
	}

	private blockPreventingSafeReturn(): ts.Block | null {
		const functionScope = this.currentFunctionScope();
		if (functionScope == null) {
			return null;
		}
		for (const tryCatchBlock of functionScope.tryCatchBlocks) {
			const catchClause = tryCatchBlock.tryStatement.catchClause;
			const finallyBlock = tryCatchBlock.tryStatement.finallyBlock;

			if (finallyBlock != null && tryCatchBlock.state !== TryVisitState.Finally) {
				return finallyBlock;
			}
			if (catchClause != null && tryCatchBlock.state === TryVisitState.Try) {
				return catchClause.block;
			}
		}
		return null;
	}

	private currentFunctionScope(): (Scope & { functionDecl: ts.FunctionLikeDeclaration }) | null {
		for (let i = this.scopes.length - 1; i >= 0; i--) {
			const scope = this.scopes[i];
			if (scope.functionDecl != null) {
				return scope as Scope & { functionDecl: ts.FunctionLikeDeclaration };
			}
		}
		return null;
	}

	private currentScopePromises(): Scope['promises'] {
		return this.scopes[this.scopes.length - 1].promises;
	}

	private enterAwaitLikeExpression(): void {
		this.scopes[this.scopes.length - 1].awaitUsages++;
	}

	private enterBlock(): void {
		this.blockLevel++;
	}

	private enterCondition(condition: ts.Node): void {
		this.conditions.push({ scopeBlockLevel: this.blockLevel, node: condition, errorInConditionals: false });
	}

	private enterScope(functionDecl?: ts.FunctionLikeDeclaration): void {
		this.blockLevel++;
		this.scopes.push({
			awaitUsages: 0,
			functionDecl: functionDecl,
			promises: new Map(),
			scopeBlockLevel: this.blockLevel,
			tryCatchBlocks: [],
		});
	}

	private exitAwaitLikeExpression(): void {
		this.scopes[this.scopes.length - 1].awaitUsages--;
	}

	private exitBlock(): void {
		this.blockLevel--;
	}

	private exitCondition(): void {
		const condition = this.conditions.pop();
		if (condition == null) {
			return;
		}

		if (!condition.errorInConditionals && isNodePromiseType(condition.node, this.typeChecker)) {
			// Let's attempt to find the concrete branch inside logical ands and ors where this has gone wrong
			let failureNode = condition.node;
			while (ts.isBinaryExpression(failureNode)) {
				if (isNodePromiseType(failureNode.left, this.typeChecker)) {
					failureNode = failureNode.left;
				} else if (isNodePromiseType(failureNode.right, this.typeChecker)) {
					failureNode = failureNode.right;
				} else {
					break;
				}
			}
			this.addFailureAtNode(failureNode, Rule.FAILURE_STRING_MISSING_AWAIT(failureNode));
			this.conditions.forEach(c => (c.errorInConditionals = true));
		}
	}

	private exitScope(): void {
		this.failCurrentScopeUnhandled();
		this.blockLevel--;
		this.scopes.pop();
	}

	private failCurrentScope(problemNode: ts.Node, failureString: (node: ts.Identifier) => string): void {
		const promises = this.currentScopePromises();
		promises.forEach(({ declNode }) => {
			this.addFailureAtNode(problemNode, failureString(declNode));
		});
		promises.clear();
	}

	private failCurrentScopeUnhandled(): void {
		const promises = this.currentScopePromises();
		promises.forEach(({ declNode }) => {
			this.addFailureAtNode(declNode, Rule.FAILURE_STRING_MISSING_AWAIT(declNode));
		});
		promises.clear();
	}

	private getScopeAndPromiseUsage(
		variableName: string,
	): { declNode: ts.Identifier; scope: Scope['promises'] } | null {
		for (const scope of this.scopes) {
			const promiseUsage = scope.promises.get(variableName);
			if (promiseUsage != null) {
				return {
					declNode: promiseUsage.declNode,
					scope: scope.promises,
				};
			}
		}
		return null;
	}

	private isAwaiting(): boolean {
		return this.scopes[this.scopes.length - 1].awaitUsages > 0;
	}

	private isConditioned(promiseVar: string): boolean {
		const scope = this.currentScopePromises();
		const varInfo = scope.get(promiseVar);
		if (varInfo == null) {
			return false;
		}

		return (
			this.conditions.length > 0 &&
			this.conditions[this.conditions.length - 1].scopeBlockLevel === varInfo.blockLevel
		);
	}

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

	public getCondition(promiseVar: string): ts.Node {
		if (!this.isConditioned(promiseVar)) {
			throw new Error('Invalid request');
		}
		return this.conditions[this.conditions.length - 1].node;
	}

	public visitArrowFunction(arrowFunc: ts.ArrowFunction): void {
		this.enterScope(arrowFunc);
		super.visitArrowFunction(arrowFunc);
		this.exitScope();
	}

	public visitAwaitExpression(awaitExp: ts.AwaitExpression): void {
		this.enterAwaitLikeExpression();
		this.visitNode(awaitExp.expression);
		this.exitAwaitLikeExpression();
		this.failCurrentScope(awaitExp, Rule.FAILURE_STRING_DEPENDS_ON_OTHER_AWAIT);
	}

	public visitBinaryExpression(binExp: ts.BinaryExpression): void {
		const op = binExp.operatorToken.getText();
		if (['=', '||', '&&'].indexOf(op) < 0) {
			return super.visitBinaryExpression(binExp);
		}

		if (op === '=') {
			const lhs = binExp.left;
			const rhs = binExp.right;
			if (
				ts.isIdentifier(lhs) &&
				(isNodePromiseType(lhs, this.typeChecker) || isNodePromiseType(rhs, this.typeChecker))
			) {
				this.visitNode(rhs);
				this.addPromiseVariable(lhs);
				return;
			}
			super.visitBinaryExpression(binExp);
			return;
		}
		// now we're && or ||
		this.visitNode(binExp.left);
		this.enterCondition(binExp.left);
		this.visitNode(binExp.right);
		this.exitCondition();
	}

	public visitBlock(block: ts.Block): void {
		const isFunctionBlock = block.parent != null && ts.isFunctionLike(block.parent);
		if (!isFunctionBlock) {
			this.enterBlock();
		}
		super.visitBlock(block);
		if (!isFunctionBlock) {
			this.exitBlock();
		}
	}

	public visitCallExpression(call: ts.CallExpression): void {
		const isPromise = isNodePromiseType(call, this.typeChecker);

		if (isPromise) {
			this.visitNode(call.expression);
			// We treat treat functions arguments to functions generating promises
			// as though we're awaiting on them,
			// except that multiples are considered handled in parrallel
			this.enterAwaitLikeExpression();
			call.arguments.forEach(node => this.visitNode(node));
			this.exitAwaitLikeExpression();
			return;
		}
		super.visitCallExpression(call);
	}

	public visitConditionalExpression(condExp: ts.ConditionalExpression): void {
		this.visitNode(condExp.condition);
		this.enterCondition(condExp.condition);
		this.visitNode(condExp.whenTrue);
		this.visitNode(condExp.whenFalse);
		this.exitCondition();
	}

	public visitConstructorDeclaration(constructorDecl: ts.ConstructorDeclaration): void {
		this.enterScope(constructorDecl);
		super.visitConstructorDeclaration(constructorDecl);
		this.exitScope();
	}

	public visitDoStatement(doStatement: ts.DoStatement): void {
		this.enterCondition(doStatement.expression);
		this.enterBlock();
		this.visitNode(doStatement.statement);
		this.exitBlock();
		this.exitCondition();
		this.visitNode(doStatement.expression);
	}

	public visitForInStatement(forInStmt: ts.ForInStatement): void {
		this.visitNode(forInStmt.initializer);
		this.visitNode(forInStmt.expression);
		this.enterCondition(forInStmt.expression);
		this.visitNode(forInStmt.statement);
		this.exitCondition();
	}

	public visitForOfStatement(forInStmt: ts.ForOfStatement): void {
		this.visitNode(forInStmt.initializer);
		this.visitNode(forInStmt.expression);
		this.enterCondition(forInStmt.expression);
		this.visitNode(forInStmt.statement);
		this.exitCondition();
	}

	public visitForStatement(forStmt: ts.ForStatement): void {
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
	}

	public visitFunctionDeclaration(funcDecl: ts.FunctionDeclaration): void {
		this.enterScope(funcDecl);
		super.visitFunctionDeclaration(funcDecl);
		this.exitScope();
	}

	public visitFunctionExpression(funcExp: ts.FunctionExpression): void {
		this.enterScope(funcExp);
		super.visitFunctionExpression(funcExp);
		this.exitScope();
	}

	public visitGetAccessor(getAccessor: ts.GetAccessorDeclaration): void {
		this.enterScope(getAccessor);
		super.visitGetAccessor(getAccessor);
		this.exitScope();
	}

	public visitIdentifier(id: ts.Identifier): void {
		const scope = this.currentScopePromises();
		const promiseType = scope.get(id.getText());

		if (promiseType != null) {
			if (isNodePromiseArrayType(id, this.typeChecker) && isArrayPropertyAccess(id)) {
				return super.visitIdentifier(id);
			}
			if (this.isConditioned(id.getText())) {
				this.addFailureAtNode(id, Rule.FAILURE_STRING_CONDITIONAL(promiseType.declNode));
				scope.delete(id.getText());
				return;
			}
			if (this.isAwaiting()) {
				if (promiseType.blockLevel === this.blockLevel) {
					scope.delete(id.getText());
				} else {
					this.addFailureAtNode(id, Rule.FAILURE_STRING_BLOCK_CONSISTENCY(id));
					scope.delete(id.getText());
				}
			} else {
				this.addFailureAtNode(promiseType.declNode, Rule.FAILURE_STRING_MISSING_AWAIT(promiseType.declNode));
				scope.delete(id.getText());
			}
		}
		if (this.isAwaiting()) {
			const info = this.getScopeAndPromiseUsage(id.getText());
			if (info != null) {
				this.addFailureAtNode(id, Rule.FAILURE_STRING_CLOSURE_SCOPING(id));
				info.scope.delete(info.declNode.getText());
			}
		}
		super.visitIdentifier(id);
	}

	public visitIfStatement(ifStmt: ts.IfStatement): void {
		this.visitNode(ifStmt.expression);
		this.enterCondition(ifStmt.expression);
		this.visitNode(ifStmt.thenStatement);
		if (ifStmt.elseStatement != null) {
			this.visitNode(ifStmt.elseStatement);
		}
		this.exitCondition();
	}

	public visitMethodDeclaration(methodDecl: ts.MethodDeclaration): void {
		this.enterScope(methodDecl);
		super.visitMethodDeclaration(methodDecl);
		this.exitScope();
	}

	public visitNode(node: ts.Node): void {
		if (ts.isAwaitExpression(node)) {
			return this.visitAwaitExpression(node);
		}
		super.visitNode(node);
	}

	public visitParameterDeclaration(paramDecl: ts.ParameterDeclaration): void {
		if (!ts.isIdentifier(paramDecl.name)) {
			return super.visitParameterDeclaration(paramDecl);
		}
		const id = paramDecl.name;
		super.visitParameterDeclaration(paramDecl);
		if (isNodePromiseType(id, this.typeChecker)) {
			this.addPromiseVariable(id);
		}
	}

	public visitReturnStatement(returnStmt: ts.ReturnStatement): void {
		// We count returns as awaits, they function more or less the same for our purpose
		this.enterAwaitLikeExpression();
		super.visitReturnStatement(returnStmt);
		this.exitAwaitLikeExpression();
		// Now - our most important exception is that we're not allowed to return a promise if we're inside
		// a try/catch statement. This will prevent catch blocks from catching the exception
		// as well as finally blocks will run before the returned promise has completed
		if (returnStmt.expression != null) {
			const getBlockPreventingSafeReturn = this.blockPreventingSafeReturn();
			if (getBlockPreventingSafeReturn != null && isNodePromiseType(returnStmt.expression, this.typeChecker)) {
				this.addFailureAtNode(
					returnStmt,
					Rule.FAILURE_STRING_RETURN_OUT_OF_TRY_CATCH_BLOCK(
						returnStmt.expression,
						getBlockPreventingSafeReturn,
					),
				);
			}
		}
		this.failCurrentScope(returnStmt, Rule.FAILURE_STRING_CONTROL_EXITS);
	}

	public visitSetAccessor(setAccessor: ts.SetAccessorDeclaration): void {
		this.enterScope(setAccessor);
		super.visitSetAccessor(setAccessor);
		this.exitScope();
	}

	public visitSwitchStatement(switchStmt: ts.SwitchStatement): void {
		this.visitNode(switchStmt.expression);
		this.enterCondition(switchStmt.expression);
		this.enterBlock();
		this.visitNode(switchStmt.caseBlock);
		this.exitBlock();
		this.exitCondition();
	}

	public visitThrowStatement(throwStmt: ts.ThrowStatement): void {
		super.visitThrowStatement(throwStmt);
		this.failCurrentScope(throwStmt, Rule.FAILURE_STRING_CONTROL_EXITS);
	}

	public visitTryStatement(tryStmt: ts.TryStatement): void {
		const tryStatementInfo = { tryStatement: tryStmt, state: TryVisitState.Try };
		const functionScope = this.currentFunctionScope();
		if (functionScope != null) {
			functionScope.tryCatchBlocks.push(tryStatementInfo);
		}
		this.visitNode(tryStmt.tryBlock);
		if (tryStmt.catchClause != null) {
			tryStatementInfo.state = TryVisitState.Catch;
			this.visitNode(tryStmt.catchClause);
		}
		if (tryStmt.finallyBlock != null) {
			tryStatementInfo.state = TryVisitState.Finally;
			this.visitNode(tryStmt.finallyBlock);
		}
		if (functionScope != null) {
			functionScope.tryCatchBlocks.pop();
		}
	}

	public visitVariableDeclaration(decl: ts.VariableDeclaration): void {
		if (decl.initializer != null) {
			super.visitVariableDeclaration(decl);
		} else {
			this.visitNode(decl.name);
			return;
		}
		const binding = decl.name;
		if (!ts.isIdentifier(binding)) {
			return;
		}

		const isPromise =
			isNodePromiseType(decl.initializer, this.typeChecker) || isNodePromiseType(binding, this.typeChecker);
		if (isPromise) {
			this.addPromiseVariable(binding);
		}
	}

	public visitWhileStatement(whileStmt: ts.WhileStatement): void {
		this.visitNode(whileStmt.expression);
		this.enterCondition(whileStmt.expression);
		this.enterBlock();
		this.visitNode(whileStmt.statement);
		this.exitBlock();
		this.exitCondition();
	}
}

function isNodePromiseType(node: ts.Node, typeChecker: ts.TypeChecker): boolean {
	const exprType = typeChecker.getTypeAtLocation(node);
	const typeNode = typeChecker.typeToTypeNode(typeChecker.getNonNullableType(exprType));

	if (typeNode == null) {
		return false;
	}

	return isPromiseType(typeNode) || isPromiseArrayType(typeNode);
}

function isNodePromiseArrayType(node: ts.Node, typeChecker: ts.TypeChecker): boolean {
	const exprType = typeChecker.getTypeAtLocation(node);
	const typeNode = typeChecker.typeToTypeNode(typeChecker.getNonNullableType(exprType));

	if (typeNode == null) {
		return false;
	}

	return isPromiseArrayType(typeNode);
}

function isPromiseType(typeNode: ts.TypeNode): boolean {
	if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
		return typeNode.types.some(x => isPromiseType(x));
	}

	if (ts.isTypeReferenceNode(typeNode)) {
		const name = ts.isIdentifier(typeNode.typeName) ? typeNode.typeName.escapedText : null;
		if (name === 'Promise') {
			return true;
		}
	}

	return isPromiseArrayType(typeNode);
}

function isPromiseArrayType(typeNode: ts.TypeNode): boolean {
	if (ts.isArrayTypeNode(typeNode)) {
		const elementType = typeNode.elementType;

		return isPromiseType(elementType);
	}
	return false;
}

function isArrayPropertyAccess(id: ts.Identifier): boolean {
	const propertyAccess = id.parent;
	if (propertyAccess != null && ts.isPropertyAccessExpression(propertyAccess) && propertyAccess.expression === id) {
		return true;
	}
	return false;
}
