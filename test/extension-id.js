'use strict';
const manifest = require('../package.json');
module.exports = `${manifest.publisher}.${manifest.name}`;
