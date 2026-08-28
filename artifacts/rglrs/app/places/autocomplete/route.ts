import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type GoogleAutocompletePayload = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Location search is unavailable." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to search for places." }, { status: 401 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Location search is unavailable." }, { status: 503 });

  const body = await request.json().catch(() => null) as { input?: unknown; sessionToken?: unknown } | null;
  const input = typeof body?.input === "string" ? body.input.trim() : "";
  const sessionToken = typeof body?.sessionToken === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(body.sessionToken)
    ? body.sessionToken
    : undefined;
  if (input.length < 3 || input.length > 100) {
    return NextResponse.json({ error: "Enter at least 3 characters." }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "suggestions.placePrediction.placeId",
          "suggestions.placePrediction.text.text",
          "suggestions.placePrediction.structuredFormat.mainText.text",
          "suggestions.placePrediction.structuredFormat.secondaryText.text",
        ].join(","),
      },
      body: JSON.stringify({ input, ...(sessionToken ? { sessionToken } : {}) }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return NextResponse.json({ error: "Place suggestions are temporarily unavailable." }, { status: 502 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Place suggestions are temporarily unavailable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => null) as GoogleAutocompletePayload | null;
  const suggestions = (payload?.suggestions || []).flatMap((suggestion) => {
    const prediction = suggestion.placePrediction;
    const name = prediction?.structuredFormat?.mainText?.text?.trim()
      || prediction?.text?.text?.trim()
      || "";
    if (!prediction?.placeId || !name) return [];
    const address = prediction.structuredFormat?.secondaryText?.text?.trim() || "";
    return [{
      id: prediction.placeId,
      name: name.slice(0, 160),
      address: address.slice(0, 240),
      label: (prediction.text?.text?.trim() || [name, address].filter(Boolean).join(", ")).slice(0, 300),
    }];
  }).slice(0, 6);

  return NextResponse.json(
    { suggestions },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}