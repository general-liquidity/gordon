// babel.config.cjs
// Optional React Compiler plumbing for Gordon's TUI.
//
// Activation is gated behind GORDON_REACT_COMPILER=1 so the default build
// path remains unchanged. See docs/react-compiler.md for details and known
// risks (Ink 6.6.0 + React Compiler compatibility is NOT yet verified).
module.exports = (api) => {
  api.cache(false);
  const useReactCompiler = process.env.GORDON_REACT_COMPILER === "1";
  return {
    plugins: useReactCompiler
      ? [["babel-plugin-react-compiler", { target: "19" }]]
      : [],
  };
};
