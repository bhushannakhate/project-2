export function isAdminUser(user, adminEmails) {
  const email = user?.email;
  return (
    user?.email_verified === true &&
    typeof email === "string" &&
    adminEmails.includes(email.trim().toLowerCase())
  );
}
