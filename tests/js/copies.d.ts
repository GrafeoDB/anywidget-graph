// The "?copy=N" imports in the tests load a second instance of a module (a notebook that reconnected), the way a
// page can hold two copies of the widget's module. Node treats the query as a distinct module; here it is `any`.
declare module "*?copy=2" {
  const module: any;
  export = module;
}
