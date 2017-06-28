# Newlines (EOL) converter CLI

*Having troubles with different files line endings?* :flushed:

This library may simple convert files of your choice to Windows (`CRLF`), or popular `LF` line ends used on Linux and Mac.

Installation: `npm i -g eol-converter-cli`

API: `eolConverter OptionalModifier "glob_files_regex"`

* *OptionalModifier* can be empty, `warmup`, or `crlf` - see examples.
* For files paths resolution is used [GLOB regex](https://www.npmjs.com/package/glob)

## Examples

See which files will be affected:

```
eolConverter warmup "**/*.js"
```

Conversions (cannot be undone):

**To LF (Unix & Mac default)**

```
eolConverter "**/*.js"
```

**To CRLF (Windows default)**

```
eolConverter crlf "**/*.{js,jsx,ts,tsx}"
```

## Notes

PS: Don't forget to configure you favourite IDE to work with desired line endings, so that you won't need this tool again! :smirk:

**Please give project :star: if you like it!**