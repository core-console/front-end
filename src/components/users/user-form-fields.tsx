import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export interface UserProfileValues {
  displayName: string | null;
  email: string | null;
  username: string | null;
}

interface UserProfileFieldsProps {
  defaultValues?: UserProfileValues;
  error?: string | null;
  idPrefix: string;
}

export function UserProfileFields({
  defaultValues,
  error,
  idPrefix,
}: UserProfileFieldsProps) {
  const invalid = error ? true : undefined;

  return (
    <FieldSet>
      <FieldLegend className="text-xs tracking-[0.04em] text-muted-foreground uppercase">
        User details
      </FieldLegend>
      <FieldGroup className="gap-1.5">
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={`${idPrefix}-display-name`}>
            Display name
          </FieldLabel>
          <Input
            aria-invalid={invalid}
            autoComplete="name"
            className="h-9"
            defaultValue={defaultValues?.displayName ?? ""}
            id={`${idPrefix}-display-name`}
            name="displayName"
            placeholder="e.g. Jane Doe"
          />
        </Field>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={`${idPrefix}-username`}>Username</FieldLabel>
          <Input
            aria-invalid={invalid}
            autoComplete="username"
            className="h-9"
            defaultValue={defaultValues?.username ?? ""}
            id={`${idPrefix}-username`}
            name="username"
            placeholder="e.g. jdoe"
          />
        </Field>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={`${idPrefix}-email`}>Email</FieldLabel>
          <Input
            aria-invalid={invalid}
            autoComplete="email"
            className="h-9"
            defaultValue={defaultValues?.email ?? ""}
            id={`${idPrefix}-email`}
            name="email"
            placeholder="e.g. jane@example.com"
            type="email"
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
    </FieldSet>
  );
}

interface UserIdentityFieldsProps {
  error?: string | null;
  idPrefix: string;
  identityIssuer?: string;
  identitySubject?: string;
  readOnly?: boolean;
}

export function UserIdentityFields({
  error,
  idPrefix,
  identityIssuer,
  identitySubject,
  readOnly = false,
}: UserIdentityFieldsProps) {
  const invalid = error ? true : undefined;

  return (
    <FieldSet>
      <FieldLegend className="text-xs tracking-[0.04em] text-muted-foreground uppercase">
        Identity
      </FieldLegend>
      <FieldDescription>
        Maps this Core Console user to an external identity.
      </FieldDescription>
      <FieldGroup className="gap-1.5">
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={`${idPrefix}-identity-issuer`}>
            Identity issuer *
          </FieldLabel>
          <Input
            aria-invalid={invalid}
            className="h-9 read-only:bg-muted/50 read-only:text-foreground"
            defaultValue={identityIssuer}
            id={`${idPrefix}-identity-issuer`}
            name="identityIssuer"
            readOnly={readOnly}
            required={!readOnly}
          />
        </Field>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={`${idPrefix}-identity-subject`}>
            Identity subject *
          </FieldLabel>
          <Input
            aria-invalid={invalid}
            className="h-9 read-only:bg-muted/50 read-only:text-foreground"
            defaultValue={identitySubject}
            id={`${idPrefix}-identity-subject`}
            name="identitySubject"
            readOnly={readOnly}
            required={!readOnly}
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
    </FieldSet>
  );
}
