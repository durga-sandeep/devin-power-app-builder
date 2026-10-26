const TONES: Record<string, string> = {
  // generic statuses
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  REJECTED: "bg-gray-200 text-gray-700",
  EXECUTED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  // roles
  viewer: "bg-gray-100 text-gray-700",
  maker: "bg-sky-100 text-sky-800",
  checker: "bg-violet-100 text-violet-800",
  admin: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ value }: { value: string }) {
  const tone = TONES[value] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {value}
    </span>
  );
}
