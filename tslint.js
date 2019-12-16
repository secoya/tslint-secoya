var path = require('path');
module.exports = {
	extends: ['tslint:recommended', 'tslint-react'],
	defaultSeverity: 'error',
	rulesDirectory: [
		'./lib',
		// So require.resolve resolves to the main entry, we need the folder.
		// This is a bit hacky and we should probably extend from tslint-microsoft-contrib instead,
		// and then disable the rules we don't want.
		path.dirname(require.resolve('tslint-microsoft-contrib')),
		path.join(path.dirname(require.resolve('tslint-react-hooks')), 'dist'),
	],
	jsRules: {
		quotemark: [true, 'single', 'jsx-double', 'avoid-escape'],
		indent: [true, 'tabs'],
		'trailing-comma': [false],
	},
	rules: {
		'array-type': [true, 'array'],
		'arrow-parens': false,
		'max-classes-per-file': [1],
		indent: [true, 'tabs'],
		quotemark: [true, 'single', 'jsx-double', 'avoid-escape'],
		'class-name': true,
		'comment-format': [true, 'check-space'],
		'interface-name': [false],
		'jsdoc-format': true,
		'linebreak-style': [true, 'LF'],
		'member-ordering': [false],
		'new-parens': true,
		'no-angle-bracket-type-assertion': true,
		'no-empty-interface': false,
		'no-unsafe-finally': true,
		'no-var-requires': true,
		'ordered-imports': [
			true,
			{
				'import-sourced-order': 'lowercase-first',
				'named-imports-order': 'lowercase-first',
			},
		],
		'object-literal-key-quotes': [true, 'as-needed'],
		'object-literal-shorthand': false,
		'triple-equals': [true, 'allow-null-check'],
		'jquery-deferred-must-complete': true,
		'jsx-alignment': true,
		'jsx-attributes-ordering': true,
		'jsx-boolean-value': true,
		'jsx-curly-spacing': 'never',
		'jsx-no-lambda': true,
		'jsx-no-string-ref': true,
		'jsx-self-close': true,
		'jsx-wrap-multiline': [false],
		'no-delete-expression': true,
		'no-disable-auto-sanitization': true,
		'no-document-domain': true,
		'no-document-write': true,
		'no-duplicate-parameter-names': true,
		'no-duplicate-switch-case': true,
		'no-empty-line-after-opening-brace': true,
		'no-exec-script': true,
		'no-function-constructor-with-string-args': true,
		'no-inner-html': true,
		'no-invalid-regexp': true,
		'no-jquery-raw-elements': true,
		'no-octal-literal': true,
		'no-relative-imports': true,
		'no-reserved-keywords': true,
		'no-sparse-arrays': true,
		'no-string-based-set-immediate': true,
		'no-string-based-set-interval': true,
		'no-string-based-set-timeout': true,
		'no-typeof-undefined': true,
		'no-unnecessary-bind': true,
		'no-unnecessary-field-initialization': true,
		'no-unnecessary-local-variable': true,
		'no-unnecessary-override': true,
		'no-with-statement': true,
		'prefer-array-literal': true,
		'promise-must-complete': true,
		'react-aware-member-ordering': [
			true,
			{
				alphabetize: true,
				order: [
					'private-static-field',
					'protected-static-field',
					'public-static-field',
					'private-static-method',
					'protected-static-method',
					'public-static-method',
					'private-instance-field',
					'protected-instance-field',
					'public-instance-field',
					'constructor',
					'react-lifecycle-method',
					'private-instance-method',
					'protected-instance-method',
					'public-instance-method',
					'react-render-method',
				],
			},
		],
		'react-this-binding-issue': true,
		'react-tsx-curly-spacing': [true, 'never'],
		'react-unused-props-and-state': true,
		'react-hooks-nesting': 'error',
		'react-hooks-exhaustive-deps': true,
		semicolon: [true, 'always', 'ignore-bound-class-methods'],
	},
};
