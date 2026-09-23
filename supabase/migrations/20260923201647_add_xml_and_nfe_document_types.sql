alter type apticket.document_type add value if not exists 'nfe' after 'nfse';
alter type apticket.document_type add value if not exists 'xml' after 'nfe';

notify pgrst, 'reload schema';
