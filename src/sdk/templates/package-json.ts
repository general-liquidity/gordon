export const PACKAGE_JSON_TEMPLATE = `{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "{{RUN_CMD}} src/index.ts",
    "dev": "{{RUN_CMD}} --watch src/index.ts"
  },
  "dependencies": {
    "@general-liquidity/gordon-cli": "latest"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
`;
