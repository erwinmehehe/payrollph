/** Display-only employee quick-access metadata from the existing verified self-service response. */
export type EmployeeQuickAccessStatus = {
  releasedPayslipCount: number;
  pendingLeaveRequestCount: number;
  todayAttendance: "clocked_in" | "complete" | "not_clocked_in";
};

export function getEmployeeQuickAccessStatus(data: {
  payslips: readonly unknown[];
  leave: { requests: readonly { status: string }[] };
  attendance: { today: { timeIn: string | null; timeOut: string | null } | null };
}): EmployeeQuickAccessStatus {
  const today = data.attendance.today;
  return {
    releasedPayslipCount: data.payslips.length,
    pendingLeaveRequestCount: data.leave.requests.filter(request => request.status === "Pending").length,
    todayAttendance: today?.timeIn
      ? (today.timeOut ? "complete" : "clocked_in")
      : "not_clocked_in",
  };
}