import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { Event } from "@/models/Event";

export async function GET() {
  try {
    await connectToDatabase();
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const events = await Event.find({}).sort({ date: 1 }).lean();
    return NextResponse.json({
      events: events.map((e) => ({
        id: String(e._id),
        title: e.title,
        description: e.description,
        date: e.date,
        time: e.time,
        venue: e.venue,
        status: e.status,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch events", error);
    return NextResponse.json({ error: "Unable to load events." }, { status: 500 });
  }
}
