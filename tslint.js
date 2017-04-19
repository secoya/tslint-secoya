var path = require('path');
module.exports = {
	"extends": [
		"tslint:recommended",
		"tslint-react"
	],
	"defaultSeverity": "warning",
	"rulesDirectory": [
		"./lib",
		// So require.resolve resolves to the main entry, we need the folder.
		// This is a bit hacky and we should probably extend from tslint-microsoft-contrib instead,
		// and then disable the rules we don't want.
		path.dirname(require.resolve("tslint-microsoft-contrib")),
	],
	"jsRules": {
		"quotemark": [
			true,
			"single",
			"jsx-double",
			"avoid-escape"
		],
		"indent": [
			true,
			"tabs"
		],
		"trailing-comma": [
			false
		]
	},
	"rules": {
		"arrow-parens": false,
		"quotemark": [
			true,
			"single",
			"jsx-double",
			"avoid-escape"
		],
		"indent": [
			true,
			"tabs"
		],
		"max-classes-per-file": [
			1
		],
		"array-type": [
			true,
			"array"
		],
		"ordered-imports": [
			true,
			{
				"import-sourced-order": "lowercase-first",
				"named-imports-order": "lowercase-first"
			}
		],
		"no-var-requires": true,
		"no-unsafe-finally": true,
		"triple-equals": [
			true,
			"allow-null-check"
		],
		"interface-name": [
			false
		],
		"linebreak-style": [
			true,
			"LF"
		],
		"comment-format": [
			true,
			"check-space"
		],
		"class-name": true,
		"new-parens": true,
		"jsdoc-format": true,
		"no-angle-bracket-type-assertion": true,
		"no-empty-interface": false,
		"object-literal-key-quotes": [
			true,
			"consistent-as-needed"
		],
		"object-literal-shorthand": false,
		"member-ordering": [
			false
		],
		"react-aware-member-ordering": [
			true,
			{
				"alphabetize": true,
				"order": [
					"private-static-field",
					"protected-static-field",
					"public-static-field",
					"private-static-method",
					"protected-static-method",
					"public-static-method",
					"private-instance-field",
					"protected-instance-field",
					"public-instance-field",
					"constructor",
					"react-lifecycle-method",
					"private-instance-method",
					"protected-instance-method",
					"public-instance-method",
					"react-render-method"
				]
			}
		],
		"jsx-no-lambda": true,
		"jsx-alignment": true,
		"jsx-boolean-value": true,
		"jsx-curly-spacing": "never",
		"jsx-no-string-ref": true,
		"jsx-self-close": true,
		"jsx-wrap-multiline": true,
		// microsoft contrib rules
		"jquery-deferred-must-complete": true,
		"no-delete-expression": true,
		"no-disable-auto-sanitization": true,
		"no-document-domain": true,
		"no-document-write": true,
		"no-duplicate-case": true,
		"no-duplicate-parameter-names": true,
		"no-empty-line-after-opening-brace": true,
		"no-exec-script": true,
		"no-function-constructor-with-string-args": true,
		"no-inner-html": true,
		"no-invalid-regexp": true,
		"no-jquery-raw-elements": true,
		"no-octal-literal": true,
		"no-relative-imports": true,
		"no-reserved-keywords": true,
		"no-sparse-arrays": true,
		"no-string-based-set-immediate": true,
		"no-string-based-set-interval": true,
		"no-string-based-set-timeout": true,
		"no-typeof-undefined": true,
		"no-unnecessary-bind": true,
		"no-unnecessary-field-initialization": true,
		"no-unnecessary-local-variable": true,
		"no-unnecessary-override": true,
		"no-with-statement": true,
		"prefer-array-literal": true,
		"promise-must-complete": true,
		"react-tsx-curly-spacing": [
			true,
			"never"
		],
		"react-this-binding-issue": true,
		"react-unused-props-and-state": true,
		"valid-typeof": true
	}
}
