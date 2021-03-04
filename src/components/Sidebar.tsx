import React, { useEffect, useState } from 'react';
import { Paragraph, Icon } from '@contentful/forma-36-react-components';
import { CollectionResponse, EntryAPI, EntrySys, Link, SidebarExtensionSDK } from '@contentful/app-sdk';

enum CHECKING_STATUS {
  Initial = "INITIAL",
  Checking = "CHECKING",
  OK = "OK",
  Failed = "FAILED"
};
interface SidebarProps {
  sdk: SidebarExtensionSDK;
}

/**
 * Checks and returns if 
 * @param sdk The Contentful SDK.
 */
function checkSubhubPages(sdk: SidebarExtensionSDK) : Promise<boolean | Array<Link>> {
  const entryId = sdk.entry.getSys().id;
  const linkedPages = sdk.entry.fields["internalPages"].getValue() as Array<Link>;
  if (linkedPages.length === 0) {
    // If there are no linked pages in this SubHub, there aren't any problems.
    return Promise.resolve(true);
  }
  return Promise.all(linkedPages.map(page => {
    const pageId = page.sys.id;
    // Fetch other subhubs that have links to this page.
    return sdk.space.getEntries({
      "content_type": "subHub",
      "fields.internalPages.sys.id": pageId,
      "sys.id[ne]":entryId
    }).then((entries: CollectionResponse<Object>) => {
      console.table(entries.items);
      console.log(`Number of other subhub that contains this page: ${entries.items.length}`);
      return entries.items.length === 0 || page;
    });
    // return sdk.space.getEntry(page.sys.id).then(entry => {
    //   console.log(`${page.sys.id}`);
    //   console.table(entry);
    //   return true;
    // });
  })).then((results : Array<true | Link>) => {
    const failedPages = results.filter(value => value !== true);
    return failedPages.length === 0;
  });
}

const Sidebar = ({sdk}: SidebarProps) => {
  const [status, setStatus] = useState(CHECKING_STATUS.Checking);
  useEffect(() => {
    const internalPagesField = sdk.entry.fields["internalPages"];
    function doCheckStatus(){
      setStatus(CHECKING_STATUS.Checking);
      checkSubhubPages(sdk).then(result => {
        if (result === true) {
          setStatus(CHECKING_STATUS.OK);
        } else {
          setStatus(CHECKING_STATUS.Failed);
        }
      });
    }
    internalPagesField.onValueChanged(doCheckStatus);
    doCheckStatus();
  }, [sdk, setStatus]);

  switch (status){
    case CHECKING_STATUS.Checking:
      return <Paragraph>Checking...</Paragraph>;
    case CHECKING_STATUS.OK:
      return <Paragraph><Icon color="positive" icon="CheckCircle" /> No reference issues detected.</Paragraph>;
    case CHECKING_STATUS.Failed:
      return <Paragraph><Icon color="negative" icon="ErrorCircle" /> One of your SubHub pages belongs to another SubHub that links back to the SubHub itself, forming a cycle. Please remove these page(s) from the SubHub.</Paragraph>;
    default:
      return <Paragraph>Checking...</Paragraph>;
  }
};

export default Sidebar;
