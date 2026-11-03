/**
 * Serializes a value as a JavaScript expression that is safe to inline inside
 * an HTML `<script>` element.
 *
 * Plain `JSON.stringify` output can contain `</script>` or `<!--` (e.g. in
 * compiler error messages captured in stdout), which would end the script
 * element early and let the rest of the data be parsed as HTML. Escaping every
 * `<` as `\u003c` keeps the result valid JSON and valid JavaScript while making
 * it impossible to break out of the element. U+2028/U+2029 are escaped too so
 * the output is also safe for pre-ES2019 parsers.
 */
export declare function serializeForScript(value: unknown): string;
/**
 * Replaces a `{{PLACEHOLDER}}` in an HTML template with the script-safe
 * serialization of `value`.
 *
 * Uses a replacer function so `$&`, `$'`, `` $` `` and `$<n>` sequences in the
 * data are inserted literally instead of being interpreted as
 * `String.prototype.replace` substitution patterns.
 */
export declare function injectScriptData(html: string, placeholder: string, value: unknown): string;
