import { defineRailway, github, postgres, project, service, volume } from "railway/iac";

/**
 * LOOP infrastructure on Railway (project "Loop", environment "production").
 * Preview with `railway config plan`, apply with `railway config apply`.
 */
export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "sfo" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "sfo",
    sizeMB: 50000,
  });

  const loop = service("loop", {
    // Pushes to main deploy automatically.
    source: github("gabpaulobenito-cmyk/loop", { branch: "main" }),
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    deploy: {
      startCommand: "npm start",
      // A failed migration stops the release; the previous deployment keeps serving.
      preDeployCommand: ["npm run migrate"],
      healthcheckPath: "/api/health",
      healthcheckTimeout: 120,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    replicas: { sfo: 1 },
    env: {
      DATABASE_URL: Postgres.env.DATABASE_URL,
      NODE_ENV: "production",
    },
  });

  return project("Loop", {
    resources: [Postgres, loop, postgresVolume],
  });
});
