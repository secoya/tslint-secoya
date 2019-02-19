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
	public static FAILURE_STRING_MISSING_AWAIT = (promiseVar: ts.Identifier) =>
		`Promise "${promiseVar.getText()}" must be handled.`;

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
	promises: Map<string, { blockLevel: number; declNode: ts.Identifier }>;
	scopeBlockLevel: number;
}

export class ProperPromiseUse extends Lint.RuleWalker {
	private awaitUsages: number = 0;
	private blockLevel: number = 0;
	private readonly conditions: { node: ts.Node; scopeBlockLevel: number }[] = [];
	private readonly scopes: Scope[] = [{ scopeBlockLevel: 0, promises: new Map() }];
	private readonly typeChecker: ts.TypeChecker;

	public constructor(sourceFile: ts.SourceFile, options: Lint.IOptions, program: ts.Program) {
		super(sourceFile, options);
		this.typeChecker = program.getTypeChecker();
	}

	private addPromiseVariable(id: ts.Identifier): void {
		const scope = this.currentScope();
		scope.set(id.getText(), {
			blockLevel: this.blockLevel,
			declNode: id,
		});
	}

	private currentScope(): Scope['promises'] {
		return this.scopes[this.scopes.length - 1].promises;
	}

	private enterAwaitLikeExpression(): void {
		this.awaitUsages++;
	}

	private enterBlock(): void {
		this.blockLevel++;
	}

	private enterCondition(condition: ts.Node): void {
		this.conditions.push({ scopeBlockLevel: this.blockLevel, node: condition });
	}

	private enterScope(): void {
		this.blockLevel++;
		this.scopes.push({
			promises: new Map(),
			scopeBlockLevel: this.blockLevel,
		});
	}

	private exitAwaitLikeExpression(): void {
		this.awaitUsages--;
	}

	private exitBlock(): void {
		this.blockLevel--;
	}

	private exitCondition(): void {
		this.conditions.pop();
	}

	private exitScope(): void {
		this.failCurrentScopeUnhandled();
		this.blockLevel--;
		this.scopes.pop();
	}

	private failCurrentScope(problemNode: ts.Node, failureString: (node: ts.Identifier) => string): void {
		const scope = this.currentScope();
		scope.forEach(({ declNode }) => {
			this.addFailureAtNode(problemNode, failureString(declNode));
		});
		scope.clear();
	}

	private failCurrentScopeUnhandled(): void {
		const scope = this.currentScope();
		scope.forEach(({ declNode }) => {
			this.addFailureAtNode(declNode, Rule.FAILURE_STRING_MISSING_AWAIT(declNode));
		});
		scope.clear();
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
		return this.awaitUsages > 0;
	}

	private isConditioned(promiseVar: string): boolean {
		const scope = this.currentScope();
		const varInfo = scope.get(promiseVar);
		if (varInfo == null) {
			return false;
		}

		return (
			this.conditions.length > 0 &&
			this.conditions[this.conditions.length - 1].scopeBlockLevel === varInfo.blockLevel
		);
	}

	public getCondition(promiseVar: string): ts.Node {
		if (!this.isConditioned(promiseVar)) {
			throw new Error('Invalid request');
		}
		return this.conditions[this.conditions.length - 1].node;
	}

	public visitArrowFunction(arrowFunc: ts.ArrowFunction): void {
		this.enterScope();
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
				(isPromiseType(lhs, this.typeChecker) || isPromiseType(rhs, this.typeChecker))
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
		const isFunctionBlock = ts.isFunctionLike(block.parent);
		if (!isFunctionBlock) {
			this.enterBlock();
		}
		super.visitBlock(block);
		if (!isFunctionBlock) {
			this.exitBlock();
		}
	}

	public visitCallExpression(call: ts.CallExpression): void {
		const isPromise = isPromiseType(call, this.typeChecker);

		if (isPromise) {
			this.visitNode(call.expression);
			// We treat treat functions arguments to functions generating promises
			// as thought we're awaiting on them,
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
		this.enterScope();
		super.visitFunctionDeclaration(funcDecl);
		this.exitScope();
	}

	public visitFunctionExpression(funcExp: ts.FunctionExpression): void {
		this.enterScope();
		super.visitFunctionExpression(funcExp);
		this.exitScope();
	}

	public visitIdentifier(id: ts.Identifier): void {
		const scope = this.currentScope();
		const promiseType = scope.get(id.getText());

		if (promiseType != null) {
			if (isPromiseArrayType(id, this.typeChecker) && isArrayPropertyAccess(id)) {
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
		if (isPromiseType(id, this.typeChecker)) {
			this.addPromiseVariable(id);
		}
	}

	public visitReturnStatement(returnStmt: ts.ReturnStatement): void {
		// We count returns as awaits, they function more or less the same for our purpose
		this.enterAwaitLikeExpression();
		super.visitReturnStatement(returnStmt);
		this.exitAwaitLikeExpression();
		this.failCurrentScope(returnStmt, Rule.FAILURE_STRING_CONTROL_EXITS);
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

		const isPromise = isPromiseType(decl.initializer, this.typeChecker) || isPromiseType(binding, this.typeChecker);
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

function isPromiseType(node: ts.Node, typeChecker: ts.TypeChecker): boolean {
	const exprType = typeChecker.getTypeAtLocation(node);
	const typeNode = typeChecker.typeToTypeNode(typeChecker.getNonNullableType(exprType));

	if (typeNode == null) {
		return false;
	}

	if (ts.isTypeReferenceNode(typeNode)) {
		const name = ts.isIdentifier(typeNode.typeName) ? typeNode.typeName.escapedText : null;
		if (name === 'Promise') {
			return true;
		}
	}

	return isPromiseArrayType(node, typeChecker);
}

function isPromiseArrayType(node: ts.Node, typeChecker: ts.TypeChecker): boolean {
	const exprType = typeChecker.getTypeAtLocation(node);
	const typeNode = typeChecker.typeToTypeNode(typeChecker.getNonNullableType(exprType));
	if (typeNode == null) {
		return false;
	}

	if (ts.isArrayTypeNode(typeNode)) {
		const elementType = typeNode.elementType;

		if (!ts.isTypeReferenceNode(elementType)) {
			return false;
		}
		return ts.isIdentifier(elementType.typeName) ? elementType.typeName.escapedText === 'Promise' : false;
	}
	return false;
}

function isArrayPropertyAccess(id: ts.Identifier): boolean {
	const propertyAccess = id.parent;
	if (ts.isPropertyAccessExpression(propertyAccess) && propertyAccess.expression === id) {
		return true;
	}
	return false;
}
