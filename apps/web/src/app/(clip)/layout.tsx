/**
 * Shell for the Campaign Clipping section.
 *
 * A sibling route group to (app), not a page inside it. Route groups do not
 * appear in the URL, so /clipping keeps its address while getting an entirely
 * different frame: its own sidebar, its own header, and none of the
 * Would-You-Rather chrome. Providers, fonts and the toaster come from the root
 * layout, which both groups nest inside — this file must not repeat them.
 *
 * Note there is deliberately no CommandMenu here. Its page list is the WYR
 * pipeline, so mounting it would put a ⌘K menu full of the other section's
 * destinations inside this one.
 */

import { ClipSidebar } from "@/components/layout/clip-sidebar";
import { ClipTopbar } from "@/components/layout/clip-topbar";

export default function ClipLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <ClipSidebar />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <ClipTopbar />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
