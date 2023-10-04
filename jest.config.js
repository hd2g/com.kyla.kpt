const { parse } = require('jsonc-parser')
const { pathsToModuleNameMapper } = require('ts-jest')
const { readFileSync } = require('fs')
const { compilerOptions } = parse(readFileSync('./tsconfig.json').toString())
const moduleNameMapper = pathsToModuleNameMapper(
  compilerOptions.paths,
  { prefix: '<rootDir>/' }
)

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper,
};
