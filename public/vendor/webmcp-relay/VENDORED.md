`embed.js` and `widget.html` are vendored verbatim from `@mcp-b/webmcp-local-relay@4.0.0`'s
`dist/browser/` (MIT licensed, https://github.com/WebMCP-org/npm-packages/tree/main/packages/webmcp-local-relay),
so mallory never loads a third-party script from a CDN at runtime. Not npm-imported since
this package is designed to be consumed as a standalone `<script>` tag, not an ES module.

To refresh after an upstream update: `npm pack @mcp-b/webmcp-local-relay@latest`, extract, and
copy `dist/browser/embed.js` + `dist/browser/widget.html` over these two files (`widget.js` in
that same directory is unused -- `widget.html`'s script is self-contained inline, confirmed by
grepping embed.js for references).
