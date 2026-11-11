{
    'name': 'Puntos Fieles POS Connector',
    'summary': 'Signed POS sales, refunds and verified reward receipt evidence for Puntos Fieles',
    'version': '18.0.3.0.0',
    'category': 'Sales/Point of Sale',
    'license': 'LGPL-3',
    'depends': ['point_of_sale'],
    'external_dependencies': {'python': ['requests']},
    'data': ['security/ir.model.access.csv', 'security/rules.xml', 'data/cron.xml', 'views/connector_views.xml', 'views/reward_views.xml'],
    'installable': True,
    'application': False,
    'auto_install': False,
    'assets': {'point_of_sale._assets_pos': ['pf_pos_connector/static/src/**/*.js', 'pf_pos_connector/static/src/**/*.xml']},
}
