const request = require("supertest");
const app = require("../app");

describe("Express App basic routes & middleware", () => {
  it("GET /api/health should return 200 with status message", async () => {
    const res = await request(app).get("/api/health");
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toContain("CraftNext API is running");
  });

  it("GET /api/unknown-route should return 404", async () => {
    const res = await request(app).get("/api/unknown-route");
    expect(res.statusCode).toEqual(404);
    expect(res.body.message).toEqual("Route not found");
  });

  it("CORS header should permit .vercel.app origin", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Origin", "https://6-sem-project-seven.vercel.app");
    expect(res.statusCode).toEqual(200);
    expect(res.headers["access-control-allow-origin"]).toEqual("https://6-sem-project-seven.vercel.app");
  });
});
