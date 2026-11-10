const {defineConfig}=require('eslint/config');
const expo=require('eslint-config-expo/flat');
module.exports=defineConfig([expo,{ignores:['dist/**','node_modules/**']},{files:['tests/**/*.ts'],rules:{'@typescript-eslint/no-explicit-any':'off'}}]);
