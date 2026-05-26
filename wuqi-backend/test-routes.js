const app = require('./src/app');

const routes = [];

const collectRoutes = (router, prefix = '') => {
  router.stack.forEach((layer) => {
    if (layer.route) {
      // 这是一个路由
      routes.push(prefix + layer.route.path);
    } else if (layer.handle && layer.handle.stack) {
      // 这是一个嵌套的路由器
      const pathMatch = layer.regexp && layer.regexp.source.match(/\^\/([^\$]*)\$/);
      const path = pathMatch ? pathMatch[1] : '';
      collectRoutes(layer.handle, prefix + path);
    }
  });
};

collectRoutes(app._router);
console.log('All routes:');
routes.forEach((route, i) => {
  console.log(i + 1, route);
});
