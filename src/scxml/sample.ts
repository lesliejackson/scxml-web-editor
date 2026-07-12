export const defaultScxml = `<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml"
       version="1.0"
       name="订单流程"
       datamodel="ecmascript"
       initial="idle">
  <datamodel>
    <data id="isApproved" expr="false"/>
  </datamodel>

  <state id="idle">
    <transition event="order.submit" target="review"/>
  </state>

  <state id="review" initial="manual">
    <state id="manual">
      <transition event="approve" target="approved"/>
      <transition event="reject" target="rejected"/>
    </state>
    <state id="approved">
      <onentry><assign location="isApproved" expr="true"/></onentry>
      <transition target="fulfillment"/>
    </state>
    <final id="rejected"/>
  </state>

  <parallel id="fulfillment">
    <state id="payment" initial="unpaid">
      <state id="unpaid"><transition event="pay" target="paid"/></state>
      <final id="paid"/>
    </state>
    <state id="shipping" initial="packing">
      <state id="packing"><transition event="ship" target="shipped"/></state>
      <final id="shipped"/>
    </state>
    <transition event="cancel" target="cancelled"/>
  </parallel>

  <final id="cancelled"/>
</scxml>`;
