import {
	DeclaringNode,
	Scope,
	ScopeBindingDeclaration,
	ScopeKind,
	ScopeReference,
	SourceFileScopesContainer,
} from '@secoya/typescript-scope-analysis';
import * as Lint from 'tslint';
import * as ts from 'typescript';

interface RuleOptions {
	additionalHooks?: RegExp;
}

export class Rule extends Lint.Rules.AbstractRule {
	public static metadata: Lint.IRuleMetadata = {
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
	public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
		return this.applyWithWalker(new ReactHooksExhaustiveDeps(sourceFile, this.getOptions()));
	}
}

function parseOptions(options: any[]): RuleOptions {
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

interface CurrentRefsCleanup {
	dependencyNode: ts.Identifier;
	dependencyNodePropertyAccess: ts.PropertyAccessExpression;
	reference: ScopeReference;
}

export class ReactHooksExhaustiveDeps extends Lint.RuleWalker {
	private readonly functionWithoutCapturedValueCache: WeakMap<ScopeBindingDeclaration, boolean>;
	private readonly ruleOptions: RuleOptions;
	private scopesContainer: SourceFileScopesContainer | null;
	private readonly setStateCallSites: WeakMap<ts.Node, ts.ArrayBindingElement>;
	private readonly stateVariables: WeakSet<ts.Node>;
	private staticKnownValueCache: WeakMap<ScopeBindingDeclaration, boolean>;

	public constructor(sourceFile: ts.SourceFile, options: Lint.IOptions) {
		super(sourceFile, options);
		this.ruleOptions = parseOptions(this.getOptions());
		this.scopesContainer = null;
		this.staticKnownValueCache = new WeakMap();
		this.functionWithoutCapturedValueCache = new WeakMap();
		this.setStateCallSites = new WeakMap();
		this.stateVariables = new WeakSet();
	}

	private getScope(node: ts.Node): Scope {
		return this.getScopesContainer().getScopeForNode(node);
	}

	private getScopesContainer() {
		if (this.scopesContainer == null) {
			this.scopesContainer = new SourceFileScopesContainer(this.getSourceFile());
		}
		return this.scopesContainer;
	}

	private visitFunctionLikeExpression(funcExpr: ts.FunctionExpression | ts.ArrowFunction): void {
		// tslint:disable:no-console
		// Only visit function expressions when the parent node is a call expression (ie. it is a parameter to a hook)
		if (!ts.isCallExpression(funcExpr.parent)) {
			return;
		}

		const callee = funcExpr.parent.expression;
		if (!ts.isIdentifier(callee) && !ts.isPropertyAccessExpression(callee)) {
			return;
		}

		const callbackIndex = getReactiveHookCallbackIndex(callee, this.ruleOptions);
		// If this function expression is not where the callback is, skip it
		if (funcExpr.parent.arguments[callbackIndex] !== funcExpr) {
			return;
		}

		// Get the reactive hook node.
		const reactiveHook = funcExpr.parent.expression;
		const reactiveHookNameNode = getNodeWithoutReactNamespace(reactiveHook, this.ruleOptions);
		if (reactiveHookNameNode == null || !ts.isIdentifier(reactiveHookNameNode)) {
			return;
		}
		const reactiveHookName = reactiveHookNameNode.text;
		const isEffect = reactiveHookName.endsWith('Effect');

		// Get the declared dependencies for this reactive hook. If there is no
		// second argument then the reactive callback will re-run on every render.
		// So no need to check for dependency inclusion.
		const depsIndex = callbackIndex + 1;
		const declaredDependenciesNode = unwrapNonSemanticExpressions(funcExpr.parent.arguments[depsIndex]);

		if (!declaredDependenciesNode && !isEffect) {
			// These are only used for optimization.
			if (reactiveHookName === 'useMemo' || reactiveHookName === 'useCallback') {
				// TODO: Can this have an autofix?
				this.addFailureAtNode(
					funcExpr.parent.expression,
					`React Hook ${reactiveHookName} does nothing when called with ` +
						`only one argument. Did you forget to pass an array of ` +
						`dependencies?`,
				);
			}
			return;
		}

		if (isEffect && isAsync(funcExpr)) {
			this.addFailureAtNode(
				funcExpr,
				`Effect callbacks are synchronous to prevent race conditions. ` +
					'Learn more about data fetching with Hooks: https://fb.me/react-hooks-data-fetching',
			);
		}

		// Get the current scope
		const scope = this.getScope(funcExpr.body);

		// Find all our "pure scopes". On every re-render of a component these
		// pure scopes may have changes to the variables declared within. So all
		// variables used in our reactive hook callback but declared in a pure
		// scope need to be listed as dependencies of our reactive hook callback.
		//
		// According to the rules of React you can't read a mutable value in pure
		// scope. We can't enforce this in a lint so we trust that all variables
		// declared outside of pure scope are indeed frozen.
		const pureScopes = new Set<Scope>();
		let componentScope: Scope | null = null;
		{
			let currentScope: Scope | null = scope.getParentScope();
			while (currentScope) {
				pureScopes.add(currentScope);
				if (currentScope.scopeKind === ScopeKind.FunctionScope) {
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

		const nonNullableComponentScope = componentScope;
		const parentScopes = getParentScopes(nonNullableComponentScope);

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
		const isStaticKnownHookValue = (binding: ScopeBindingDeclaration): boolean => {
			const def = binding.declaringNode;
			// Look for `let stuff = ...`
			if (!ts.isVariableDeclaration(def)) {
				return false;
			}
			const init = def.initializer;
			if (init == null) {
				return false;
			}
			// Detect primitive constants
			// const foo = 42
			const declaration = def.parent;
			if (!ts.isVariableDeclarationList(declaration)) {
				return false;
			}
			if (
				isConstVariableDeclaration(declaration) &&
				(ts.isStringLiteral(init) || ts.isNumericLiteral(init) || init.kind === ts.SyntaxKind.NullKeyword)
			) {
				// Definitely static
				return true;
			}
			// Detect known Hook calls
			// const [_, setState] = useState()
			if (!ts.isCallExpression(init)) {
				return false;
			}
			let expr = init.expression;
			// Step into `= React.something` initializer.
			if (
				ts.isPropertyAccessExpression(expr) &&
				ts.isIdentifier(expr.expression) &&
				expr.expression.text === 'React'
			) {
				expr = expr.name;
			}
			if (!ts.isIdentifier(expr)) {
				return false;
			}
			const id = def.name;
			const { text: name } = expr;
			if (name === 'useRef' && ts.isIdentifier(id)) {
				// useRef() return value is static.
				return true;
			} else if (name === 'useState' || name === 'useReducer') {
				// Only consider second value in initializing tuple static.
				if (ts.isArrayBindingPattern(id) && id.elements.length === 2) {
					const firstBinding = id.elements[0];
					const secondBinding = id.elements[1];
					// Is second tuple value the same reference we're checking?
					if (
						ts.isBindingElement(secondBinding) &&
						ts.isIdentifier(secondBinding.name) &&
						secondBinding.name.text === binding.identifier
					) {
						if (name === 'useState') {
							const references = binding.references;
							for (const reference of references) {
								this.setStateCallSites.set(reference.identifier, firstBinding);
							}
						}
						// Setter is static.
						return true;
					} else if (
						ts.isBindingElement(firstBinding) &&
						ts.isIdentifier(firstBinding.name) &&
						firstBinding.name.text === binding.identifier
					) {
						if (name === 'useState') {
							const references = binding.references;
							for (const reference of references) {
								this.stateVariables.add(reference.identifier);
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
		function isFunctionWithoutCapturedValues(binding: ScopeBindingDeclaration) {
			// Search the direct component subscopes for
			// top-level function definitions matching this reference.
			const fnNode = binding.declaringNode;
			const childScopes = nonNullableComponentScope.getChildScopes();
			let fnScope = null;
			for (const childScope of childScopes) {
				const childScopeBlock = childScope.getDeclaringNode();
				if (
					// function handleChange() {}
					((ts.isFunctionDeclaration(fnNode) || ts.isFunctionExpression(fnNode)) &&
						childScopeBlock === fnNode) ||
					// const handleChange = function() {}
					// const handleChange = () => {}
					(ts.isVariableDeclaration(fnNode) && childScopeBlock === fnNode.initializer)
				) {
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
			const fnParentScopes = getParentScopes(fnScope);
			for (const reference of fnScope
				.getAllReferencesRecursively()
				.filter((x) => x.referenceTo != null && fnParentScopes.has(x.referenceTo!.scope))) {
				if (
					// Filter ensures referenceTo is not null
					pureScopes.has(reference.referenceTo!.scope) &&
					// Static values are fine though,
					// although we won't check functions deeper.
					!memoizedIsStaticKnownHookValue(reference.referenceTo!.binding)
				) {
					return false;
				}
			}
			// If we got here, this function doesn't capture anything
			// from render--or everything it captures is known static.
			return true;
		}

		// Remember such values. Avoid re-running extra checks on them.
		const memoizedIsStaticKnownHookValue = memoizeWithWeakMap(isStaticKnownHookValue, this.staticKnownValueCache);
		const memoizedIsFunctionWithoutCapturedValues = memoizeWithWeakMap(
			isFunctionWithoutCapturedValues,
			this.functionWithoutCapturedValueCache,
		);

		// These are usually mistaken. Collect them.
		const currentRefsInEffectCleanup = new Map<string, CurrentRefsCleanup>();

		// Is this reference inside a cleanup function for this effect node?
		// We can check by traversing scopes upwards  from the reference, and checking
		// if the last "return () => " we encounter is located directly inside the effect.
		function isInsideEffectCleanup(reference: ScopeReference): boolean {
			let curScope: Scope | null = reference.referencedFromScope;
			let isInReturnedFunction = false;
			while (curScope != null && curScope.getDeclaringNode() !== funcExpr) {
				const declaringNode = curScope.getDeclaringNode();
				if (ts.isArrowFunction(declaringNode) || ts.isFunctionExpression(declaringNode)) {
					isInReturnedFunction = declaringNode.parent != null && ts.isReturnStatement(declaringNode.parent);
				}

				curScope = curScope.getParentScope();
			}
			return isInReturnedFunction;
		}

		// Get dependencies from all our resolved references in pure scopes.
		// Key is dependency string, value is whether it's static.
		const dependencies = new Map<string, { isStatic: boolean; references: ScopeReference[] }>();
		gatherDependenciesRecursively(scope);

		function gatherDependenciesRecursively(currentScope: Scope): void {
			for (const reference of currentScope.getReferences()) {
				// If we can't resolve the reference we don't care
				if (reference.referenceTo == null) {
					continue;
				}
				// If it is not declared in a pure scope we don't care
				if (!pureScopes.has(reference.referenceTo.scope)) {
					continue;
				}

				const referenceNode = fastFindReferenceWithParent(funcExpr, reference.identifier);
				if (referenceNode == null) {
					continue;
				}

				const dependencyNode = getDependency(referenceNode);
				const dependency = toPropertyAccessString(dependencyNode);

				// Accessing ref.current inside effect cleanup is bad.
				if (
					// We're in an effect...
					isEffect &&
					// ... and this look like accessing .current...
					ts.isIdentifier(dependencyNode) &&
					ts.isPropertyAccessExpression(dependencyNode.parent) &&
					dependencyNode.parent.name.text === 'current' &&
					isInsideEffectCleanup(reference)
				) {
					currentRefsInEffectCleanup.set(dependency, {
						dependencyNode: dependencyNode,
						dependencyNodePropertyAccess: dependencyNode.parent,
						reference: reference,
					});
				}

				const declaringBinding = reference.referenceTo!.binding;
				const declaringNode = declaringBinding.declaringNode;

				// Ignore references to the function itself as it's not defined yet.
				if (getDeclaringExpr(declaringNode) === funcExpr.parent) {
					continue;
				}

				const existingDependency = dependencies.get(dependency);
				if (existingDependency == null) {
					const isStatic =
						memoizedIsStaticKnownHookValue(declaringBinding) ||
						memoizedIsFunctionWithoutCapturedValues(declaringBinding);
					dependencies.set(dependency, {
						isStatic: isStatic,
						references: [reference],
					});
				} else {
					existingDependency.references.push(reference);
				}
			}
			for (const childScope of currentScope.getChildScopes()) {
				gatherDependenciesRecursively(childScope);
			}
		}

		// Warn about accessing .current in cleanup effects.
		currentRefsInEffectCleanup.forEach(
			({ reference, dependencyNode, dependencyNodePropertyAccess }, dependency) => {
				const references = reference.referenceTo!.binding.references;
				// Is React managing this ref or us?
				// Let's see if we can find a .current assignment.
				let foundCurrentAssignment = false;
				for (const refReference of references) {
					const { identifier } = refReference;
					const { parent } = identifier;
					if (
						parent != null &&
						// ref.current
						ts.isPropertyAccessExpression(parent) &&
						parent.name.text === 'current' &&
						parent.expression === identifier &&
						// ref.current = <something>
						ts.isBinaryExpression(parent.parent) &&
						parent.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
						parent.parent.left === parent
					) {
						foundCurrentAssignment = true;
						break;
					}
				}
				// We only want to warn about React-managed refs.
				if (foundCurrentAssignment) {
					return;
				}
				this.addFailureAtNode(
					dependencyNodePropertyAccess.name,
					`The ref value '${dependency}.current' will likely have ` +
						`changed by the time this effect cleanup function runs. If ` +
						`this ref points to a node rendered by React, copy ` +
						`'${dependency}.current' to a variable inside the effect, and ` +
						`use that variable in the cleanup function.`,
				);
			},
		);

		// Warn about assigning to variables in the outer scope.
		// Those are usually bugs.
		const staleAssignments = new Set();
		const reportStaleAssignment = (writeExpr: ts.Expression, key: string) => {
			if (staleAssignments.has(key)) {
				return;
			}
			staleAssignments.add(key);
			this.addFailureAtNode(
				writeExpr,
				`Assignments to the '${key}' variable from inside React Hook ` +
					`${reactiveHook.getText()} will be lost after each ` +
					`render. To preserve the value over time, store it in a useRef ` +
					`Hook and keep the mutable value in the '.current' property. ` +
					`Otherwise, you can move this variable directly inside ` +
					`${reactiveHook.getText()}.`,
			);
		};

		// Remember which deps are optional and report bad usage first.
		const optionalDependencies = new Set<string>();
		dependencies.forEach(({ isStatic, references }, key) => {
			if (isStatic) {
				optionalDependencies.add(key);
			}
			references.forEach((reference) => {
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
			let setStateInsideEffectWithoutDeps: string | null = null;
			dependencies.forEach(({ isStatic, references }, key) => {
				if (setStateInsideEffectWithoutDeps) {
					return;
				}
				references.forEach((reference) => {
					if (setStateInsideEffectWithoutDeps) {
						return;
					}

					const id = reference.identifier;
					const isSetState = this.setStateCallSites.has(id);
					if (!isSetState) {
						return;
					}

					let fnScope: Scope | null = reference.referencedFromScope;
					while (
						fnScope != null &&
						fnScope.scopeKind !== ScopeKind.FunctionScope &&
						(!ts.isFunctionDeclaration(fnScope.getDeclaringNode()) ||
							!ts.isArrowFunction(fnScope.getDeclaringNode()))
					) {
						fnScope = fnScope.getParentScope();
					}
					if (fnScope == null) {
						return;
					}
					const isDirectlyInsideEffect = fnScope.getDeclaringNode() === funcExpr;
					if (isDirectlyInsideEffect) {
						// TODO: we could potentially ignore early returns.
						setStateInsideEffectWithoutDeps = key;
					}
				});
			});
			if (setStateInsideEffectWithoutDeps) {
				// tslint:disable-next-line:no-shadowed-variable
				const { suggestedDependencies } = collectRecommendations({
					declaredDependencies: [],
					dependencies,
					externalDependencies: new Set(),
					isEffect: true,
					optionalDependencies,
				});
				this.addFailureAtNode(
					callee,
					`React Hook ${reactiveHookName} contains a call to '${setStateInsideEffectWithoutDeps}'. ` +
						`Without a list of dependencies, this can lead to an infinite chain of updates. ` +
						`To fix this, pass [` +
						suggestedDependencies.join(', ') +
						`] as a second argument to the ${reactiveHookName} Hook.`,
				);
			}
			return;
		}
		const declaredDependencies: { key: string; node: ts.Node }[] = [];
		const externalDependencies = new Set<string>();

		if (!ts.isArrayLiteralExpression(declaredDependenciesNode)) {
			// If the declared dependencies are not an array expression then we
			// can't verify that the user provided the correct dependencies. Tell
			// the user this in an error.
			this.addFailureAtNode(
				declaredDependenciesNode,
				`React Hook ${reactiveHook.getText()} was passed a ` +
					'dependency list that is not an array literal. This means we ' +
					"can't statically verify whether you've passed the correct " +
					'dependencies.',
			);
		} else {
			declaredDependenciesNode.elements.forEach((declaredDependencyNode) => {
				// Skip elided elements.
				if (ts.isOmittedExpression(declaredDependencyNode)) {
					return;
				}
				// If we see a spread element then add a special warning.
				if (ts.isSpreadElement(declaredDependencyNode)) {
					this.addFailureAtNode(
						declaredDependencyNode,
						`React Hook ${reactiveHook.getText()} has a spread ` +
							"element in its dependency array. This means we can't " +
							"statically verify whether you've passed the " +
							'correct dependencies.',
					);
					return;
				}
				// Try to normalize the declared dependency. If we can't then an error
				// will be thrown. We will catch that error and report an error.
				let declaredDependency;
				try {
					declaredDependency = toPropertyAccessString(declaredDependencyNode);
				} catch (error) {
					if (/Unsupported node type/.test(error.message)) {
						if (
							ts.isStringLiteral(declaredDependencyNode) ||
							ts.isNumericLiteral(declaredDependencyNode) ||
							declaredDependencyNode.kind === ts.SyntaxKind.FalseKeyword ||
							declaredDependencyNode.kind === ts.SyntaxKind.TrueKeyword ||
							declaredDependencyNode.kind === ts.SyntaxKind.NullKeyword ||
							declaredDependencyNode.kind === ts.SyntaxKind.UndefinedKeyword
						) {
							if (
								ts.isStringLiteral(declaredDependencyNode) &&
								dependencies.has(declaredDependencyNode.text)
							) {
								this.addFailureAtNode(
									declaredDependencyNode,
									`The '${declaredDependencyNode.text}' literal is not a valid dependency ` +
										`because it never changes. ` +
										`Did you mean to include ${declaredDependencyNode.text} in the array instead?`,
								);
							} else {
								this.addFailureAtNode(
									declaredDependencyNode,
									`The ${declaredDependencyNode.getText()} literal is not a valid dependency ` +
										'because it never changes. You can safely remove it.',
								);
							}
						} else {
							this.addFailureAtNode(
								declaredDependencyNode,
								`React Hook ${reactiveHook.getText()} has a ` +
									`complex expression in the dependency array. ` +
									'Extract it to a separate variable so it can be statically checked.',
							);
						}
						return;
					} else {
						throw error;
					}
				}

				let maybeID = declaredDependencyNode;
				while (ts.isPropertyAccessExpression(maybeID) || ts.isElementAccessExpression(maybeID)) {
					maybeID = maybeID.expression;
				}
				const isDeclaredInComponent = !nonNullableComponentScope
					.getAllReferencesRecursively()
					.some(
						(ref) =>
							ref.identifier === maybeID &&
							(ref.referenceTo == null || parentScopes.has(ref.referenceTo.scope)),
					);

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
		const recommendations = collectRecommendations({
			declaredDependencies,
			dependencies,
			externalDependencies,
			isEffect,
			optionalDependencies,
		});
		const { duplicateDependencies, missingDependencies, unnecessaryDependencies } = recommendations;
		let { suggestedDependencies } = recommendations;

		const problemCount = duplicateDependencies.size + missingDependencies.size + unnecessaryDependencies.size;

		if (problemCount === 0) {
			// If nothing else to report, check if some callbacks
			// are bare and would invalidate on every render.
			const bareFunctions = scanForDeclaredBareFunctions({
				componentScope,
				declaredDependencies,
				declaredDependenciesNode,
				scope,
			});
			bareFunctions.forEach(({ fn, suggestUseCallback }) => {
				const { line } = ts.getLineAndCharacterOfPosition(
					declaredDependenciesNode.getSourceFile(),
					declaredDependenciesNode.getStart(),
				);
				let message =
					`The '${fn.identifier}' function makes the dependencies of ` +
					`${reactiveHookName} Hook (at line ${line}) ` +
					`change on every render.`;
				if (suggestUseCallback) {
					message +=
						` To fix this, ` + `wrap the '${fn.identifier}' definition into its own useCallback() Hook.`;
				} else {
					message +=
						` Move it inside the ${reactiveHookName} callback. ` +
						`Alternatively, wrap the '${fn.identifier}' definition into its own useCallback() Hook.`;
				}
				// TODO: What if the function needs to change on every render anyway?
				// Should we suggest removing effect deps as an appropriate fix too?
				this.addFailureAtNode(fn.declaringNode, message);
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
				declaredDependencies: [], // Pretend we don't know
				dependencies,
				externalDependencies,
				isEffect,
				optionalDependencies,
			}).suggestedDependencies;
		}

		// Alphabetize the suggestions, but only if deps were already alphabetized.
		function areDeclaredDepsAlphabetized(): boolean {
			if (declaredDependencies.length === 0) {
				return true;
			}
			const declaredDepKeys = declaredDependencies.map((dep) => dep.key);
			const sortedDeclaredDepKeys = declaredDepKeys.slice().sort();
			return declaredDepKeys.join(',') === sortedDeclaredDepKeys.join(',');
		}
		if (areDeclaredDepsAlphabetized()) {
			suggestedDependencies.sort();
		}

		function getWarningMessage(
			deps: Set<string>,
			singlePrefix: string,
			label: string,
			fixVerb: string,
		): string | null {
			if (deps.size === 0) {
				return null;
			}
			return (
				(deps.size > 1 ? '' : singlePrefix + ' ') +
				label +
				' ' +
				(deps.size > 1 ? 'dependencies' : 'dependency') +
				': ' +
				joinEnglish(
					Array.from(deps)
						.sort()
						.map((name) => "'" + name + "'"),
				) +
				`. Either ${fixVerb} ${deps.size > 1 ? 'them' : 'it'} or remove the dependency array.`
			);
		}

		let extraWarning = '';
		if (unnecessaryDependencies.size > 0) {
			let badRef: string | null = null;
			Array.from(unnecessaryDependencies.keys()).forEach((key) => {
				if (badRef !== null) {
					return;
				}
				if (key.endsWith('.current')) {
					badRef = key;
				}
			});
			if (badRef !== null) {
				extraWarning =
					` Mutable values like '${badRef}' aren't valid dependencies ` +
					"because mutating them doesn't re-render the component.";
			} else if (externalDependencies.size > 0) {
				const dep = Array.from(externalDependencies)[0];
				const binding = scope.getBinding(dep);
				// Don't show this warning for things that likely just got moved *inside* the callback
				// because in that case they're clearly not referring to globals.
				if (binding == null || binding[1] !== scope) {
					extraWarning =
						` Outer scope values like '${dep}' aren't valid dependencies ` +
						`because mutating them doesn't re-render the component.`;
				}
			}
		}

		// `props.foo()` marks `props` as a dependency because it has
		// a `this` value. This warning can be confusing.
		// So if we're going to show it, append a clarification.
		if (!extraWarning && missingDependencies.has('props')) {
			const propDep = dependencies.get('props');
			if (propDep == null) {
				return;
			}
			const refs = propDep.references;
			if (!Array.isArray(refs)) {
				return;
			}
			let isPropsOnlyUsedInMembers = true;
			for (const ref of refs) {
				const id = fastFindReferenceWithParent(componentScope.getDeclaringNode(), ref.identifier);
				if (!id) {
					isPropsOnlyUsedInMembers = false;
					break;
				}
				const parent = id.parent;
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
					` However, 'props' will change when *any* prop changes, so the ` +
					`preferred fix is to destructure the 'props' object outside of ` +
					`the ${reactiveHookName} call and refer to those specific props ` +
					`inside ${reactiveHook.getText()}.`;
			}
		}

		if (!extraWarning && missingDependencies.size > 0) {
			// See if the user is trying to avoid specifying a callable prop.
			// This usually means they're unaware of useCallback.
			let missingCallbackDep: string | null = null;
			missingDependencies.forEach((missingDep) => {
				if (missingCallbackDep) {
					return;
				}
				// Is this a variable from top scope?
				const topScopeRef = nonNullableComponentScope.getBinding(missingDep);
				const usedDep = dependencies.get(missingDep);
				if (usedDep == null || topScopeRef == null) {
					return;
				}
				if (usedDep.references[0].referenceTo!.binding !== topScopeRef[0]) {
					return;
				}
				// Is this a destructured prop?
				const def = topScopeRef[0].declaringNode;
				if (!ts.isParameter(def)) {
					return;
				}
				// Was it called in at least one case? Then it's a function.
				let isFunctionCall = false;
				for (const { identifier: id } of usedDep.references) {
					if (
						id != null &&
						id.parent != null &&
						ts.isCallExpression(id.parent) &&
						id.parent.expression === id
					) {
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
				missingCallbackDep = missingDep;
			});
			if (missingCallbackDep !== null) {
				extraWarning =
					` If '${missingCallbackDep}' changes too often, ` +
					`find the parent component that defines it ` +
					`and wrap that definition in useCallback.`;
			}
		}

		if (!extraWarning && missingDependencies.size > 0) {
			let setStateRecommendation: { form: string; missingDep: string; setter: string } | null = null;
			for (const missingDep of Array.from(missingDependencies)) {
				if (setStateRecommendation !== null) {
					break;
				}
				const usedDep = dependencies.get(missingDep);
				if (usedDep == null) {
					break;
				}
				const references = usedDep.references;
				for (const { identifier: id, referenceTo } of references) {
					let maybeCall = id.parent;
					// Try to see if we have setState(someExpr(missingDep)).
					while (maybeCall != null && maybeCall !== nonNullableComponentScope.getDeclaringNode()) {
						if (ts.isCallExpression(maybeCall)) {
							const correspondingStateVariable = this.setStateCallSites.get(maybeCall.expression);
							if (correspondingStateVariable != null) {
								if (
									ts.isBindingElement(correspondingStateVariable) &&
									ts.isIdentifier(correspondingStateVariable.name) &&
									correspondingStateVariable.name.text === missingDep
								) {
									// setCount(count + 1)
									setStateRecommendation = {
										form: 'updater',
										missingDep,
										setter: maybeCall.expression.getText(),
									};
								} else if (this.stateVariables.has(id)) {
									// setCount(count + increment)
									setStateRecommendation = {
										form: 'reducer',
										missingDep,
										setter: maybeCall.expression.getText(),
									};
								} else {
									// If it's a parameter *and* a missing dep,
									// it must be a prop or something inside a prop.
									// Therefore, recommend an inline reducer.
									const def = referenceTo!.binding.declaringNode;
									if (ts.isParameter(def)) {
										setStateRecommendation = {
											form: 'inlineReducer',
											missingDep,
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
							` You can also replace multiple useState variables with useReducer ` +
							`if '${setStateRecommendation.setter}' needs the ` +
							`current value of '${setStateRecommendation.missingDep}'.`;
						break;
					case 'inlineReducer':
						extraWarning =
							` If '${setStateRecommendation.setter}' needs the ` +
							`current value of '${setStateRecommendation.missingDep}', ` +
							`you can also switch to useReducer instead of useState and ` +
							`read '${setStateRecommendation.missingDep}' in the reducer.`;
						break;
					case 'updater':
						extraWarning =
							` You can also do a functional update '${
								setStateRecommendation.setter
							}(${setStateRecommendation.missingDep.substring(0, 1)} => ...)' if you only need '${
								setStateRecommendation.missingDep
							}'` + ` in the '${setStateRecommendation.setter}' call.`;
						break;
					default:
						throw new Error('Unknown case.');
				}
			}
		}
		this.addFailureAtNode(
			declaredDependenciesNode,
			`React Hook ${reactiveHook.getText()} has ` +
				// To avoid a long message, show the next actionable item.
				(getWarningMessage(missingDependencies, 'a', 'missing', 'include') ||
					getWarningMessage(unnecessaryDependencies, 'an', 'unnecessary', 'exclude') ||
					getWarningMessage(duplicateDependencies, 'a', 'duplicate', 'omit')) +
				extraWarning,
		);
	}

	public visitArrowFunction(arrowExpr: ts.ArrowFunction): void {
		this.visitFunctionLikeExpression(arrowExpr);
		super.visitArrowFunction(arrowExpr);
	}

	public visitFunctionExpression(funcExpr: ts.FunctionExpression): void {
		this.visitFunctionLikeExpression(funcExpr);
		super.visitFunctionExpression(funcExpr);
	}
}

/**
 * What's the index of callback that needs to be analyzed for a given Hook?
 * -2 if it is not a hook
 * -1 if it's not a Hook we care about (e.g. useState).
 * 0 for useEffect/useMemo/useCallback(fn).
 * 1 for useImperativeHandle(ref, fn).
 * For additionally configured Hooks, assume that they're like useEffect (0).
 */
function getReactiveHookCallbackIndex(calleeNode: ts.Identifier | ts.MemberExpression, options: RuleOptions): number {
	const node = getNodeWithoutReactNamespace(calleeNode, options);
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
				let name;
				try {
					name = toPropertyAccessString(node);
				} catch (error) {
					if (/Unsupported node type/.test(error.message)) {
						return 0;
					} else {
						throw error;
					}
				}
				return options.additionalHooks.test(name) ? 0 : -1;
			} else {
				return -1;
			}
	}
}

function joinEnglish(arr: string[]): string {
	let s = '';
	for (let i = 0; i < arr.length; i++) {
		s += arr[i];
		if (i === 0 && arr.length === 2) {
			s += ' and ';
		} else if (i === arr.length - 2 && arr.length > 2) {
			s += ', and ';
		} else if (i < arr.length - 1) {
			s += ', ';
		}
	}
	return s;
}

function isSameIdentifier(a: ts.Node, b: ts.Node): boolean {
	return a === b;
}

function isAncestorNodeOf(a: ts.Node, b: ts.Node): boolean {
	return a.getStart() <= b.getStart() && a.getEnd() >= b.getEnd();
}

/**
 * This seems to deal with various side effects in the original lint rule.
 * For now let's just assume this works as intended.
 * It seems sometimes the eslint stuff won't assign .parent as intended
 * this is not an issue for us.
 */
function fastFindReferenceWithParent(start: ts.Node, target: ts.Node): ts.Node | null {
	const queue: ts.Node[] = [start];
	let item: ts.Node | undefined | null = null;
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

		ts.forEachChild(item, (value) => {
			if (isNodeLike(value)) {
				queue.push(value);
			}
		});
	}

	return null;
}

function getNodeWithoutReactNamespace(
	node: ts.LeftHandSideExpression,
	options: RuleOptions,
): ts.Identifier | ts.MemberExpression | null {
	if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'React') {
		return node.name;
	}
	if (ts.isIdentifier(node)) {
		return node;
	}
	return null;
}

function isAsync(funcExpr: ts.FunctionExpression | ts.ArrowFunction): boolean {
	return funcExpr.modifiers == null ? false : funcExpr.modifiers.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
}

/**
 * Assuming () means the passed node.
 * (foo) -> 'foo'
 * foo.(bar) -> 'foo.bar'
 * foo.bar.(baz) -> 'foo.bar.baz'
 * Otherwise throw.
 */
function toPropertyAccessString(node: ts.Node): string {
	if (ts.isIdentifier(node)) {
		return node.text;
	} else if (ts.isPropertyAccessExpression(node)) {
		const object = toPropertyAccessString(node.expression);
		const property = toPropertyAccessString(node.name);
		return `${object}.${property}`;
	} else {
		throw new Error(`Unsupported node type: ${ts.SyntaxKind[node.kind]}`);
	}
}

function isNodeLike(nodeLike: any): nodeLike is ts.Node {
	return nodeLike != null && nodeLike.kind != null && ts.SyntaxKind[nodeLike.kind] != null;
}

/**
 * Assuming () means the passed/returned node:
 * (props) => (props)
 * props.(foo) => (props.foo)
 * props.foo.(bar) => (props).foo.bar
 * props.foo.bar.(baz) => (props).foo.bar.baz
 */
function getDependency(node: ts.Node): ts.Node {
	if (
		ts.isPropertyAccessExpression(node.parent) &&
		node.parent.expression === node &&
		node.parent.name.text !== 'current' &&
		!(
			node.parent.parent != null &&
			ts.isCallExpression(node.parent.parent) &&
			node.parent.parent.expression === node.parent
		)
	) {
		return getDependency(node.parent);
	} else {
		return node;
	}
}

function memoizeWithWeakMap<TKey extends object, TValue>(fn: (key: TKey) => TValue, map: WeakMap<TKey, TValue>) {
	return (arg: TKey): TValue => {
		const val = map.get(arg);
		if (val !== undefined) {
			return val;
		}
		const result = fn(arg);
		map.set(arg, result);
		return result;
	};
}

function isConstVariableDeclaration(decl: ts.VariableDeclarationList): boolean {
	// tslint:disable-next-line:no-bitwise
	return (decl.flags & ts.NodeFlags.Const) !== 0;
}

interface DepTree {
	/**
	 * Nodes for properties
	 */
	children: Map<string, DepTree>;

	/**
	 * True if something deeper is used by code
	 */
	hasRequiredNodesBelow: boolean;

	/**
	 * True if used in code
	 */
	isRequired: boolean;

	/**
	 * True if specified in deps
	 */
	isSatisfiedRecursively: boolean;
}

// The meat of the logic.
function collectRecommendations({
	declaredDependencies,
	dependencies,
	optionalDependencies,
	externalDependencies,
	isEffect,
}: {
	declaredDependencies: { key: string; node: ts.Node }[];
	dependencies: Map<string, { isStatic: boolean; references: ScopeReference[] }>;
	externalDependencies: Set<string>;
	isEffect: boolean;
	optionalDependencies: Set<string>;
}) {
	// Our primary data structure.
	// It is a logical representation of property chains:
	// `props` -> `props.foo` -> `props.foo.bar` -> `props.foo.bar.baz`
	//         -> `props.lol`
	//         -> `props.huh` -> `props.huh.okay`
	//         -> `props.wow`
	// We'll use it to mark nodes that are *used* by the programmer,
	// and the nodes that were *declared* as deps. Then we will
	// traverse it to learn which deps are missing or unnecessary.
	const depTree = createDepTree();
	function createDepTree(): DepTree {
		return {
			children: new Map(), // Nodes for properties
			hasRequiredNodesBelow: false, // True if something deeper is used by code
			isRequired: false, // True if used in code
			isSatisfiedRecursively: false, // True if specified in deps
		};
	}

	// Mark all required nodes first.
	// Imagine exclamation marks next to each used deep property.
	dependencies.forEach((_, key) => {
		const node = getOrCreateNodeByPath(depTree, key);
		node.isRequired = true;
		markAllParentsByPath(depTree, key, (parent) => {
			parent.hasRequiredNodesBelow = true;
		});
	});

	// Mark all satisfied nodes.
	// Imagine checkmarks next to each declared dependency.
	declaredDependencies.forEach(({ key }) => {
		const node = getOrCreateNodeByPath(depTree, key);
		node.isSatisfiedRecursively = true;
	});
	optionalDependencies.forEach((key) => {
		const node = getOrCreateNodeByPath(depTree, key);
		node.isSatisfiedRecursively = true;
	});

	// Tree manipulation helpers.
	function getOrCreateNodeByPath(rootNode: DepTree, path: string): DepTree {
		const keys = path.split('.');
		let node = rootNode;
		for (const key of keys) {
			let child = node.children.get(key);
			if (!child) {
				child = createDepTree();
				node.children.set(key, child);
			}
			node = child;
		}
		return node;
	}
	function markAllParentsByPath(rootNode: DepTree, path: string, fn: (depTree: DepTree) => void) {
		const keys = path.split('.');
		let node = rootNode;
		for (const key of keys) {
			const child = node.children.get(key);
			if (!child) {
				return;
			}
			fn(child);
			node = child;
		}
	}

	// Now we can learn which dependencies are missing or necessary.
	const missingDependencies = new Set<string>();
	const satisfyingDependencies = new Set<string>();
	scanTreeRecursively(depTree, missingDependencies, satisfyingDependencies, (key) => key);
	function scanTreeRecursively(
		node: DepTree,
		missingPaths: Set<string>,
		satisfyingPaths: Set<string>,
		keyToPath: (key: string) => string,
	) {
		node.children.forEach((child, key) => {
			const path = keyToPath(key);
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
			scanTreeRecursively(child, missingPaths, satisfyingPaths, (childKey) => path + '.' + childKey);
		});
	}

	// Collect suggestions in the order they were originally specified.
	const suggestedDependencies: string[] = [];
	const unnecessaryDependencies = new Set<string>();
	const duplicateDependencies = new Set<string>();
	declaredDependencies.forEach(({ key }) => {
		// Does this declared dep satisfy a real need?
		if (satisfyingDependencies.has(key)) {
			if (suggestedDependencies.indexOf(key) === -1) {
				// Good one.
				suggestedDependencies.push(key);
			} else {
				// Duplicate.
				duplicateDependencies.add(key);
			}
		} else {
			if (isEffect && !key.endsWith('.current') && !externalDependencies.has(key)) {
				// Effects are allowed extra "unnecessary" deps.
				// Such as resetting scroll when ID changes.
				// Consider them legit.
				// The exception is ref.current which is always wrong.
				if (suggestedDependencies.indexOf(key) === -1) {
					suggestedDependencies.push(key);
				}
			} else {
				// It's definitely not needed.
				unnecessaryDependencies.add(key);
			}
		}
	});

	// Then add the missing ones at the end.
	missingDependencies.forEach((key) => {
		suggestedDependencies.push(key);
	});

	return {
		duplicateDependencies,
		missingDependencies,
		suggestedDependencies,
		unnecessaryDependencies,
	};
}

// Finds functions declared as dependencies
// that would invalidate on every render.
function scanForDeclaredBareFunctions({
	declaredDependencies,
	declaredDependenciesNode,
	componentScope,
	scope,
}: {
	componentScope: Scope;
	declaredDependencies: { key: string; node: ts.Node }[];
	declaredDependenciesNode: ts.Node;
	scope: Scope;
}): { fn: ScopeBindingDeclaration; suggestUseCallback: boolean }[] {
	const bareFunctions = declaredDependencies
		.map(({ key }) => {
			const binding = componentScope.getBinding(key);
			if (binding == null || binding[1] !== componentScope) {
				return null;
			}
			const fnRef = binding[0];
			const fnNode = fnRef.declaringNode;
			if (fnNode == null) {
				return null;
			}
			// const handleChange = function () {}
			// const handleChange = () => {}
			if (
				ts.isVariableDeclaration(fnNode) &&
				fnNode.initializer != null &&
				(ts.isArrowFunction(fnNode.initializer) || ts.isFunctionExpression(fnNode.initializer))
			) {
				return fnRef;
			}
			// function handleChange() {}
			if (ts.isFunctionDeclaration(fnNode)) {
				return fnRef;
			}
			return null;
		})
		.filter(Boolean) as ScopeBindingDeclaration[];

	function isUsedOutsideOfHook(fnRef: ScopeBindingDeclaration): boolean {
		let foundWriteExpr = false;
		for (const reference of fnRef.references) {
			if (reference.writeExpr) {
				if (foundWriteExpr) {
					// Two writes to the same function.
					return true;
				} else {
					// Ignore first write as it's not usage.
					foundWriteExpr = true;
					continue;
				}
			}
			let currentScope: Scope | null = reference.referencedFromScope;
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

	return bareFunctions.map((fnRef) => ({
		fn: fnRef,
		suggestUseCallback: isUsedOutsideOfHook(fnRef),
	}));
}

function getParentScopes(scope: Scope): Set<Scope> {
	let parentScope = scope.getParentScope();
	const scopes = new Set<Scope>();
	while (parentScope != null) {
		scopes.add(parentScope);
		parentScope = parentScope.getParentScope();
	}
	return scopes;
}

function getDeclaringExpr(declaringNode: DeclaringNode): ts.Node {
	if (ts.isVariableDeclaration(declaringNode) && declaringNode.initializer != null) {
		return declaringNode.initializer;
	}
	return declaringNode;
}

function unwrapNonSemanticExpressions(exp?: ts.Expression): ts.Expression | undefined {
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
