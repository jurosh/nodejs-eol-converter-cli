# Newlines (EOL) converter CLI

*Having troubles with different line endings?* :flushed:

This library will simply convert files of your choice to Windows (`CRLF`), or popular `LF` line ends used on Linux and Mac.

Installation:

```
npm i -g eol-converter-cli
```

API: `eolConverter OptionalModifier "glob_files_regex"`

* *OptionalModifier* can be empty, `warmup`, or `crlf` - see examples.
* For files paths resolution is used [GLOB regex](https://www.npmjs.com/package/glob)

## Examples

Run just warmup - to see which files will be affected:

```
eolConverter warmup "**/*.js"
```

Run conversions (cannot be undone):

**To LF (Unix & Mac default)**

```
eolConverter "**/*.js"
eolConverter "**/*.{js,jsx,ts,tsx}"
eolConverter "src/**/*.js"
eolConverter "{src,tests}/**/*.js"
```

**To CRLF (Windows default)**

```
eolConverter crlf "**/*.js"
```

## Tips

PS: Don't forget to configure you favourite IDE to work with desired line endings, so that you won't need this tool again! :smirk:

**Please give project :star: if you like it!**

## License

Apache 2.0 &copy; [Juraj Husár](https://jurosh.com)
