// Lets Node require TypeScript files (the vendored kdbxweb, tests/compat/run.ts) in tests: esbuild strips the types, file by file,
// like `ts-node --transpile-only` used to. Nothing checks types here, so TypeScript itself isn't needed.
// Usage: node -r ./tools/ts-register.cjs tests/compat/run.ts
const fs = require('node:fs');
const { transformSync } = require('esbuild');

require.extensions['.ts'] = (module, filename) => {
    const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
        loader: 'ts', format: 'cjs', target: 'node22', sourcefile: filename, sourcemap: 'inline'
    });
    module._compile(code, filename);
};
