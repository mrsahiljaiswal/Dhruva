import { healthResponseSchema } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";

type Status = "loading" | "ok" | "down";

export function ApiStatus() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/v1/health", { signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json();
        const parsed = healthResponseSchema.safeParse(body);
        if (!response.ok || !parsed.success || parsed.data.data.status !== "ok") {
          setStatus("down");
          return;
        }
        setStatus("ok");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setStatus("down");
      });

    return () => controller.abort();
  }, []);

  if (status === "loading") {
    return <Spinner label="Checking API" />;
  }

  if (status === "down") {
    return (
      <ErrorState
        title="API unreachable"
        description="The server is not responding. Start it, then refresh this page."
      />
    );
  }

  return <Badge>API connected</Badge>;
}
