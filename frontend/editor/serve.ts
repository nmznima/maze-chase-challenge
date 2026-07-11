import index from "./index.html";

const port = Number(process.env.PORT ?? 3001);
Bun.serve({
  port,
  routes: {
    "/": index,
    "/codec.worker.js": new Response(Bun.file("frontend/editor/codec.worker.js"), {
      headers: { "content-type": "text/javascript; charset=utf-8" },
    }),
  },
  development: { hmr: true, console: true },
});
console.log(`Maze Chase editor running at http://localhost:${port}`);
