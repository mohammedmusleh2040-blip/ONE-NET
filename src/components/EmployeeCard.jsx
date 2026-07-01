import React from "react";

export default function EmployeeCard({
  employee,
  onEdit,
  onDelete,
  onSalary,
  onAdvance,
  onStatement,
}) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 4px 12px rgba(0,0,0,.08)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 15,
      }}
    >
      <div>
        <h3 style={{ margin: 0 }}>{employee.name}</h3>

        <div style={{ color: "#666", marginTop: 8 }}>
          {employee.job_title || "بدون وظيفة"}
        </div>

        <div style={{ marginTop: 10 }}>
          💰 الراتب :
          <b> {Number(employee.salary || 0).toLocaleString()} ريال</b>
        </div>

        <div style={{ marginTop: 5 }}>
          📞 {employee.phone || "-"}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <button onClick={() => onSalary(employee)}>💰 صرف راتب</button>

        <button onClick={() => onAdvance(employee)}>💵 سلفة</button>

        <button onClick={() => onStatement(employee)}>
          📄 كشف حساب
        </button>

        <button onClick={() => onEdit(employee)}>
          ✏️ تعديل
        </button>

        <button
          onClick={() => onDelete(employee)}
          style={{
            background: "#d32f2f",
            color: "#fff",
          }}
        >
          حذف
        </button>
      </div>
    </div>
  );
}
