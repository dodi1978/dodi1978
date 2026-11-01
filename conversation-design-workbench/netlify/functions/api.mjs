// Netlify entry point: every /api/* request goes to the app in src/app.js.
import { getApp } from "../../src/runtime.js";

export default async (request) => {
  try {
    const app = await getApp();
    return await app.handle(request);
  } catch (err) {
    console.error(err);
    return Response.json({ error: "The server could not start. Check the database settings (see DEPLOY.md)." }, { status: 503 });
  }
};

export const config = { path: "/api/*" };
