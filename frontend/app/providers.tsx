"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { UIProvider } from "@/lib/ui-store";

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <UIProvider>
        {children}
        <CommandPalette />
      </UIProvider>
    </QueryClientProvider>
  );
}
