import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GITHUB_REPOSITORY is set automatically by GitHub Actions as "owner/repo".
// This makes the build work at https://<owner>.github.io/<repo>/ without
// hardcoding the repo name, while still defaulting to "/" for local dev.
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  plugins: [react()],
  base: repoName ? `/${repoName}/` : "/",
});
