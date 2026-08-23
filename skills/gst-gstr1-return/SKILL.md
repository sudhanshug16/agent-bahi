<!-- agent-bahi-skill id="gst-gstr1-return" version="1" -->
<!-- operation: company.status -->
<!-- operation: gst.return.readiness-report -->
<!-- operation: gst.gstr1-artifact.preview -->
<!-- operation: gst.gstr1-artifact.prepare -->
<!-- operation: gst.gstr1-artifact.validate -->
<!-- operation: gst.gstr1-artifact.export -->
<!-- operation: gst.gstr1-artifact.show -->
<!-- step: gst.return.readiness-report kind="OPERATION" operation="gst.return.readiness-report" -->
<!-- step: gst.gstr1-artifact.preview kind="OPERATION" operation="gst.gstr1-artifact.preview" -->
<!-- step: gst.gstr1-artifact.prepare kind="OPERATION" operation="gst.gstr1-artifact.prepare" -->
<!-- step: gst.gstr1-artifact.validate kind="OPERATION" operation="gst.gstr1-artifact.validate" -->
<!-- step: gst.gstr1-artifact.export kind="OPERATION" operation="gst.gstr1-artifact.export" -->
<!-- step: gstn-submit kind="EXTERNAL" -->

# GST GSTR-1 return

Inspect `company.status` first and provide explicit tenant and BookSet scope,
GST registration, period, readiness snapshot, and schema pack. Require READY
readiness, preview before preparation/export, and preserve source, artifact,
schema, and validation evidence. Local validation is not official validation.
Export is a HUMAN-gated handoff and never means government submission; surface
typed blockers instead of filling missing statutory facts.
