variable "github_oidc_provider_arn" {
  type = string
  description = "Provide the existing GitHub Actions OIDC provider ARN, if present."
  default = ""
  validation {
    condition = var.github_oidc_provider_arn == "" || can(regex("^arn:aws:iam::[0-9]{12}:oidc-provider/token\\.actions\\.githubusercontent\\.com$",var.github_oidc_provider_arn))
    error_message = "Must be an existing GitHub Actions OIDC provider ARN."
  }
}
variable "retention_days" {
  type = number
  default = 30
  description = "Irreversible Object Lock COMPLIANCE retention for uploaded versions. Approve before applying."
  validation {
    condition = var.retention_days >= 30 && var.retention_days <= 365 && floor(var.retention_days) == var.retention_days
    error_message = "Only 30-365 whole days allowed."
  }
}
