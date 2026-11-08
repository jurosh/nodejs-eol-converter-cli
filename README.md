# Newlines (EOL) converter CLI

*Having troubles with different line endings?* :flushed:

This library will simply convert files of your choice to Windows (`CRLF`), or popular `LF` line ends used on Linux and Mac.

Installation:

```
npm i -g eol-converter-cli
```

API: `eolConverter [warmup] [lf|crlf] "glob_pattern"`

* The target is optional: `lf` (default) or `crlf`. Prefix with `warmup` for a dry run - see examples.
* File paths are resolved with a [glob pattern](https://www.npmjs.com/package/glob). Quote it so your shell does not expand it.
* Requires Node.js 22.8 or newer.

## Examples

Run just warmup - to see which files will be affected:

```
eolConverter warmup "**/*.js"
eolConverter warmup crlf "**/*.js"
```

Run conversions (cannot be undone):

**To LF (Unix & Mac default)**

```
eolConverter "**/*.js"
eolConverter lf "**/*.js"
eolConverter lf "**/*.{js,jsx,ts,tsx}"
eolConverter lf "src/**/*.js"
eolConverter lf "{src,tests}/**/*.js"
```

**To CRLF (Windows default)**

```
eolConverter crlf "**/*.js"
```

## Behaviour

* Every `\r\n`, lone `\r` and `\n` is normalized to the target line ending. A lone `\r` (classic Mac) is intentionally rewritten too.
* Only regular files that are valid UTF-8 and contain no NUL byte are touched; others (most binary and UTF-16 files), symlinks and files above 256 MiB are skipped with a message. Detection is content-based: binary or BOM-less UTF-16 data that happens to be valid NUL-free UTF-8 is treated as text, so use the glob to target text files only.
* `**/node_modules/**` and `**/.git/**` are always ignored. `**` does not descend into symlinked directories, but a symlinked directory named explicitly in the pattern is followed, and the ignore list applies to the path as written, not to the symlink target.
* Files whose content would not change are not rewritten, so their mtime stays intact.
* Files are rewritten in place, so owner, permissions, ACLs, extended attributes and hard links are kept. Read-only files are reported as failed and left untouched. A write interrupted mid-way (e.g. the process is killed) can leave a file partially written.
* Exit code is `0` on success, `1` if any file failed, `2` on usage error or when no file matched.

## Tips

PS: Don't forget to configure you favourite IDE to work with desired line endings, so that you won't need this tool again! :smirk:

**Please give project :star: if you like it!**

## License

Apache 2.0 &copy; [Juraj Husár](https://jurosh.com)
