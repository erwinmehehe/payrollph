terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.80, < 7.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}
provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = { Application = "PayrollPH", Purpose = "P0-4 encrypted offsite recovery", ManagedBy = "Terraform" }
  }
}
