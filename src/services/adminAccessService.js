export function isAdminUser(user, adminEmails) {
  const email = user?.email;
  const normalizedAdminEmails = (Array.isArray(adminEmails)
    ? adminEmails
    : [adminEmails]
  )
    .flatMap((value) =>
      typeof value === "string" ? value.split(",") : [],
    )
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return (
    user?.email_verified === true &&
    typeof email === "string" &&
    normalizedAdminEmails.includes(email.trim().toLowerCase())
  );
}
