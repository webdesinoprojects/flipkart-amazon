import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const serverBaseUrl = process.env.SERVER_FALLBACK_BASE_URL;

test.describe("Phase 9 Docker server fallback", () => {
  test.skip(
    !serverBaseUrl,
    "Set SERVER_FALLBACK_BASE_URL to the Caddy origin.",
  );

  test("exposes local providers and the shared ProcessingEvent model", async ({
    page,
    request,
  }) => {
    const health = await request.get(`${serverBaseUrl}/health/ready`);
    expect(health.ok()).toBe(true);
    await expect(health.json()).resolves.toMatchObject({
      database: "local_postgres",
      storage: "local",
      queue: "celery-valkey",
      imagekit_enabled: false,
      ai_enabled: false,
      vision_providers: [],
    });

    const created = await request.post(`${serverBaseUrl}/api/v1/batches`);
    expect(created.status()).toBe(201);
    const batch = (await created.json()) as { id: string };
    const events = await request.get(
      `${serverBaseUrl}/api/v1/batches/${batch.id}/events`,
    );
    expect(events.ok()).toBe(true);
    await expect(events.json()).resolves.toEqual([
      expect.objectContaining({
        id: `${batch.id}:event:0`,
        sequence: 0,
        batchId: batch.id,
        stage: "ingest",
        status: "queued",
        progress: 0,
      }),
    ]);

    const fixture = await PDFDocument.create();
    fixture.addPage([300, 500]);
    const fixtureBytes = await fixture.save();
    const upload = await request.post(
      `${serverBaseUrl}/api/v1/batches/${batch.id}/documents`,
      {
        multipart: {
          file: {
            name: "../../private customer.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from(fixtureBytes),
          },
        },
      },
    );
    expect(upload.status()).toBe(202);
    expect((await upload.json()).safe_name).toBe("private_customer.pdf");

    await expect
      .poll(
        async () => {
          const current = await request.get(
            `${serverBaseUrl}/api/v1/batches/${batch.id}`,
          );
          const payload = (await current.json()) as {
            documents: { page_count: number | null; status: string }[];
          };
          return payload.documents[0];
        },
        { timeout: 20_000 },
      )
      .toMatchObject({ page_count: 1, status: "parsed" });

    const workerEvents = await request.get(
      `${serverBaseUrl}/api/v1/batches/${batch.id}/events?after=0`,
    );
    const workerPayload = (await workerEvents.json()) as {
      stage: string;
      status: string;
    }[];
    expect(workerPayload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "ingest", status: "success" }),
        expect.objectContaining({ stage: "parse", status: "running" }),
        expect.objectContaining({ stage: "parse", status: "success" }),
        expect.objectContaining({ stage: "classify", status: "queued" }),
      ]),
    );

    await page.goto(`${serverBaseUrl}/app`);
    await expect(
      page.getByRole("heading", { name: "INSPECT EVERY SOURCE PAGE." }),
    ).toBeVisible();
  });
});
