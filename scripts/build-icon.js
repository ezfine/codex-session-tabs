'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'resources/icon-source.svg'));
const png = new Resvg(source, { fitTo: { mode: 'width', value: 256 } }).render().asPng();
fs.writeFileSync(path.join(root, 'resources/icon.png'), png);
console.log('Built resources/icon.png (256 x 256)');
