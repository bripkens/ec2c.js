# Changelog

## 1.5.2
 - List of instances fails to build up when names for instances cannot be determined.
 - Mouse cursor is invisible when quickly confirming selections in the input prompt.

## v1.5.1
 - Instances name tag check should not be case sensitive.

## v1.5.0
 - Show public DNS name next to the instances' zones.
 - Improve order of matched instances with similar scores.

## v1.4.0
 - Cache instance list for five minutes before refreshing the list from AWS.
 - Show instance state in instance selection.

## v1.3.0
 - Define search query as command line argument.
 - Highlight search query matches in instance selection.

## v1.2.0
 - Define a private key for SSH connections via the `EC2C_PRIVATE_KEY` environment variable.

## v1.1.1
 - Do not define an empty default user name when the environment variable is not set.

## v1.1.0
 - Support definition of a default user name via `EC2C_DEFAULT_USER_NAME`.
 - Do not log a stack trace when the SSH connection terminates with a non-zero exit code.

## v1.0.0
 - Initial Release
