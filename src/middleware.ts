import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const role = request.auth?.user?.role;
  if (!request.auth?.user) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (role !== "admin" && role !== "super_admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
